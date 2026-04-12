import type {
  TaskDAG,
  TaskResult,
  OrchestrationStatus,
  OrchestrationState,
  ModelTier,
} from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { McpManager } from "../mcp/client.js";
import type { AuditLog } from "./audit.js";

import { validateDAG, getReadyNodes } from "./dag.js";
import {
  createOrchestrationState,
  transition,
  transitionTask,
} from "./state-machine.js";
import { createAuditLog, recordAuditEvent } from "./audit.js";
import { delegateTask } from "../delegate.js";

// ── Public interfaces ───────────────────────────────────────────────

export interface SchedulerCallbacks {
  onTaskStarted?: (nodeId: string, nodeName: string) => Promise<void>;
  onTaskCompleted?: (nodeId: string, nodeName: string, result: TaskResult) => Promise<void>;
  onTaskFailed?: (nodeId: string, nodeName: string, error: string) => Promise<void>;
  onApprovalRequired?: (gateId: string, gateName: string) => Promise<boolean>;
  onPhaseTransition?: (from: OrchestrationStatus, to: OrchestrationStatus) => Promise<void>;
}

export interface SchedulerOptions {
  maxParallelTasks?: number;  // default 4
  taskTimeoutMs?: number;     // default 300_000
  mcpManager?: McpManager;
}

export interface SchedulerResult {
  status: OrchestrationStatus;
  taskResults: Map<string, TaskResult>;
  auditLog: AuditLog;
  error?: string;
  durationMs: number;
}

// ── Scheduler ───────────────────────────────────────────────────────

export async function runScheduler(
  dag: TaskDAG,
  router: ModelRouter,
  options?: SchedulerOptions,
  callbacks?: SchedulerCallbacks,
): Promise<SchedulerResult> {
  const startTime = Date.now();
  const maxParallel = options?.maxParallelTasks ?? 4;
  const mcpManager = options?.mcpManager ?? (null as unknown as McpManager);

  // 1. Validate DAG
  validateDAG(dag);

  // 2. Create initial state and audit log
  let state = createOrchestrationState(dag);
  const auditLog = createAuditLog(dag.id);

  // 3. Transition to running
  state = transition(state, "running");
  recordAuditEvent(auditLog, {
    type: "orchestration_started",
    message: `Orchestration "${dag.name}" started`,
  });

  const resolvedGates = new Set<string>();
  const running = new Map<string, Promise<void>>();

  // Helper: transition orchestration with callback
  async function transitionOrch(to: OrchestrationStatus, error?: string): Promise<void> {
    const from = state.status;
    state = transition(state, to, error);
    if (callbacks?.onPhaseTransition) {
      await callbacks.onPhaseTransition(from, to);
    }
  }

  // Helper: dispatch a single task
  function dispatchTask(nodeId: string): void {
    const node = dag.nodes.find((n) => n.id === nodeId)!;

    // pending -> ready -> running
    state = transitionTask(state, nodeId, "ready");
    state = transitionTask(state, nodeId, "running");

    const taskPromise = (async () => {
      // Fire onTaskStarted callback
      if (callbacks?.onTaskStarted) {
        await callbacks.onTaskStarted(nodeId, node.name);
      }

      recordAuditEvent(auditLog, {
        type: "task_started",
        message: `Task "${node.name}" started`,
        taskId: nodeId,
      });

      const startedAt = Date.now();
      const client = router.getClient(node.tier);

      // Build task description from name + description + context
      const taskDesc = [node.name, node.description, node.context]
        .filter(Boolean)
        .join(": ");

      try {
        const delegationResult = await delegateTask(
          taskDesc,
          node.profile,
          client,
          mcpManager,
          { silent: true },
        );

        const completedAt = Date.now();

        if (delegationResult.success) {
          const taskResult: TaskResult = {
            nodeId,
            status: "completed",
            output: delegationResult.response,
            toolsUsed: delegationResult.toolsUsed,
            turns: delegationResult.turns,
            startedAt,
            completedAt,
            tier: node.tier,
          };

          state = transitionTask(state, nodeId, "completed");
          state.taskResults.set(nodeId, taskResult);

          recordAuditEvent(auditLog, {
            type: "task_completed",
            message: `Task "${node.name}" completed`,
            taskId: nodeId,
          });

          if (callbacks?.onTaskCompleted) {
            await callbacks.onTaskCompleted(nodeId, node.name, taskResult);
          }
        } else {
          const taskResult: TaskResult = {
            nodeId,
            status: "failed",
            error: delegationResult.error ?? "Task failed",
            toolsUsed: delegationResult.toolsUsed,
            turns: delegationResult.turns,
            startedAt,
            completedAt,
            tier: node.tier,
          };

          state = transitionTask(state, nodeId, "failed");
          state.taskResults.set(nodeId, taskResult);

          recordAuditEvent(auditLog, {
            type: "task_failed",
            message: `Task "${node.name}" failed: ${delegationResult.error}`,
            taskId: nodeId,
          });

          if (callbacks?.onTaskFailed) {
            await callbacks.onTaskFailed(nodeId, node.name, delegationResult.error ?? "Task failed");
          }
        }
      } catch (err) {
        const completedAt = Date.now();
        const errorMsg = err instanceof Error ? err.message : String(err);

        const taskResult: TaskResult = {
          nodeId,
          status: "failed",
          error: errorMsg,
          toolsUsed: [],
          turns: 0,
          startedAt,
          completedAt,
          tier: node.tier,
        };

        state = transitionTask(state, nodeId, "failed");
        state.taskResults.set(nodeId, taskResult);

        recordAuditEvent(auditLog, {
          type: "task_failed",
          message: `Task "${node.name}" threw: ${errorMsg}`,
          taskId: nodeId,
        });

        if (callbacks?.onTaskFailed) {
          await callbacks.onTaskFailed(nodeId, node.name, errorMsg);
        }
      }
    })();

    running.set(nodeId, taskPromise);

    // Remove from running map when done
    taskPromise.then(() => running.delete(nodeId));
  }

  // 4. Main loop
  try {
    while (true) {
      // Check for terminal state
      if (["completed", "failed", "cancelled"].includes(state.status)) {
        break;
      }

      // a. Check if any task failed
      const hasFailed = [...state.taskStatuses.values()].some((s) => s === "failed");
      if (hasFailed) {
        await transitionOrch("failed", "A task failed");
        recordAuditEvent(auditLog, {
          type: "orchestration_failed",
          message: "Orchestration failed due to task failure",
        });
        break;
      }

      // b. Check for pending gates
      let gateHandled = false;
      for (const gate of dag.gates) {
        if (resolvedGates.has(gate.id)) continue;

        const allAfterDone = gate.afterNodes.every(
          (id) => state.taskStatuses.get(id) === "completed",
        );
        if (!allAfterDone) continue;

        // Gate is active — need approval
        gateHandled = true;

        await transitionOrch("awaiting_approval");
        recordAuditEvent(auditLog, {
          type: "approval_requested",
          message: `Gate "${gate.name}" requires approval`,
          gateId: gate.id,
        });

        let approved = false;
        if (callbacks?.onApprovalRequired) {
          approved = await callbacks.onApprovalRequired(gate.id, gate.name);
        }

        if (approved) {
          resolvedGates.add(gate.id);
          await transitionOrch("approved");
          recordAuditEvent(auditLog, {
            type: "approval_granted",
            message: `Gate "${gate.name}" approved`,
            gateId: gate.id,
          });
          await transitionOrch("running");
          recordAuditEvent(auditLog, {
            type: "gate_resolved",
            message: `Gate "${gate.name}" resolved, resuming`,
            gateId: gate.id,
          });
        } else {
          await transitionOrch("cancelled");
          recordAuditEvent(auditLog, {
            type: "approval_denied",
            message: `Gate "${gate.name}" denied, cancelling`,
            gateId: gate.id,
          });
          break;
        }
      }

      if (["completed", "failed", "cancelled"].includes(state.status)) {
        break;
      }

      // c. Get ready nodes
      const readyNodes = getReadyNodes(dag, state.taskStatuses, resolvedGates);

      if (readyNodes.length === 0 && running.size === 0) {
        // Check if all done
        const allCompleted = [...state.taskStatuses.values()].every(
          (s) => s === "completed" || s === "skipped",
        );
        if (allCompleted) {
          await transitionOrch("completed");
          recordAuditEvent(auditLog, {
            type: "orchestration_completed",
            message: `Orchestration "${dag.name}" completed successfully`,
          });
          break;
        } else {
          // Stuck — nothing ready, nothing running, not all done
          await transitionOrch("failed", "Scheduler stuck: no ready or running tasks");
          recordAuditEvent(auditLog, {
            type: "orchestration_failed",
            message: "Orchestration stuck with no progress possible",
          });
          break;
        }
      }

      // d. Dispatch ready tasks up to available slots
      const availableSlots = maxParallel - running.size;
      const toDispatch = readyNodes.slice(0, availableSlots);

      for (const nodeId of toDispatch) {
        dispatchTask(nodeId);
      }

      // e. Wait for at least one task to finish before re-looping
      if (running.size > 0) {
        await Promise.race(running.values());
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (!["completed", "failed", "cancelled"].includes(state.status)) {
      try {
        state = transition(state, "failed", errorMsg);
      } catch {
        // already terminal
      }
    }
    recordAuditEvent(auditLog, {
      type: "orchestration_failed",
      message: `Orchestration error: ${errorMsg}`,
    });
  }

  return {
    status: state.status,
    taskResults: state.taskResults,
    auditLog,
    error: state.error,
    durationMs: Date.now() - startTime,
  };
}
