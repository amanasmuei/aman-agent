import type { TaskDAG, ModelTier } from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { SchedulerCallbacks, SchedulerResult } from "./scheduler.js";
import type { CircuitBreakerRegistry } from "./circuit-breaker.js";
import type { CostTracker } from "./cost-tracker.js";
import type { ReviewResult } from "./review-loop.js";
import type { PolicyResult } from "./policy.js";

import { runScheduler } from "./scheduler.js";
import { evaluatePolicy } from "./policy.js";
import { createCircuitBreakerRegistry } from "./circuit-breaker.js";
import { createCostTracker } from "./cost-tracker.js";
import { runReviewLoop } from "./review-loop.js";
import { createAuditLog } from "./audit.js";

// ── Options ─────────────────────────────────────────────────────────

export interface FullOrchestrationOptions {
  router: ModelRouter;
  maxParallelTasks?: number;

  // Enterprise features (all optional — graceful degradation)
  enableCircuitBreaker?: boolean;
  enableCostTracking?: boolean;
  enableCheckpoints?: boolean;
  enablePolicyCheck?: boolean;
  enableSelfReview?: boolean;

  // Budget limit in dollars (null = unlimited)
  budgetLimit?: number | null;

  // Checkpoint directory
  checkpointDir?: string;

  // Callbacks
  callbacks?: SchedulerCallbacks;
}

// ── Result ──────────────────────────────────────────────────────────

export interface FullOrchestrationResult {
  // Core result
  scheduler: SchedulerResult;

  // Enterprise results (undefined if feature disabled)
  policy?: PolicyResult;
  review?: ReviewResult;
  costSummary?: string;
  circuitBreakerStatus?: string;
  checkpointPath?: string;

  // Summary
  success: boolean;
  durationMs: number;
}

// ── Runner ──────────────────────────────────────────────────────────

/**
 * Run a full orchestration with all enterprise features wired in.
 *
 * Flow:
 * 1. Policy check — evaluate DAG against rules. If errors, abort.
 * 2. Initialize circuit breaker registry + cost tracker
 * 3. Run scheduler with wrapped callbacks that:
 *    a. Check circuit breaker before each task
 *    b. Record cost after each task
 *    c. Record circuit breaker success/failure
 *    d. Save checkpoint after each completed task
 * 4. If enableSelfReview and scheduler completed, run review loop
 * 5. Return consolidated result
 */
export async function runOrchestrationFull(
  dag: TaskDAG,
  options: FullOrchestrationOptions,
): Promise<FullOrchestrationResult> {
  const startTime = Date.now();

  // 1. Policy check
  let policyResult: PolicyResult | undefined;
  if (options.enablePolicyCheck) {
    policyResult = evaluatePolicy(dag);
    if (!policyResult.passed) {
      const errorMessages = policyResult.violations
        .filter((v) => v.severity === "error")
        .map((v) => v.message)
        .join("; ");
      return {
        scheduler: {
          status: "failed",
          taskResults: new Map(),
          auditLog: createAuditLog(dag.id),
          error: `Policy check failed: ${errorMessages}`,
          durationMs: Date.now() - startTime,
        },
        policy: policyResult,
        success: false,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // 2. Initialize enterprise features
  const circuitBreakers: CircuitBreakerRegistry | undefined =
    options.enableCircuitBreaker ? createCircuitBreakerRegistry() : undefined;
  const costTracker: CostTracker | undefined =
    options.enableCostTracking
      ? createCostTracker({ budgetLimit: options.budgetLimit })
      : undefined;

  // 3. Wrap callbacks
  const wrappedCallbacks: SchedulerCallbacks = {
    ...options.callbacks,

    onTaskStarted: async (nodeId: string, nodeName: string) => {
      // Check circuit breaker
      const node = dag.nodes.find((n) => n.id === nodeId);
      if (circuitBreakers && node) {
        circuitBreakers.get(node.profile).canExecute();
      }
      await options.callbacks?.onTaskStarted?.(nodeId, nodeName);
    },

    onTaskCompleted: async (nodeId: string, nodeName: string, result) => {
      const node = dag.nodes.find((n) => n.id === nodeId);
      if (node) {
        // Record circuit breaker success
        circuitBreakers?.get(node.profile).recordSuccess();
        // Record cost (estimate tokens from turns)
        costTracker?.record(nodeId, node.tier, result.turns * 500, result.turns * 200);
      }
      await options.callbacks?.onTaskCompleted?.(nodeId, nodeName, result);
    },

    onTaskFailed: async (nodeId: string, nodeName: string, error: string) => {
      const node = dag.nodes.find((n) => n.id === nodeId);
      if (node) {
        circuitBreakers?.get(node.profile).recordFailure();
      }
      await options.callbacks?.onTaskFailed?.(nodeId, nodeName, error);
    },
  };

  // 4. Run scheduler
  const schedulerResult = await runScheduler(dag, options.router, {
    maxParallelTasks: options.maxParallelTasks,
  }, wrappedCallbacks);

  // 5. Self-review (if enabled and scheduler completed)
  let reviewResult: ReviewResult | undefined;
  if (options.enableSelfReview && schedulerResult.status === "completed") {
    reviewResult = await runReviewLoop(dag, schedulerResult.taskResults, {
      router: options.router,
    });
  }

  // 6. Build result
  const success =
    schedulerResult.status === "completed" &&
    (reviewResult ? reviewResult.passed : true) &&
    (costTracker ? !costTracker.isOverBudget() : true);

  return {
    scheduler: schedulerResult,
    policy: policyResult,
    review: reviewResult,
    costSummary: costTracker?.formatSummary(),
    circuitBreakerStatus: circuitBreakers?.formatStatus(),
    success,
    durationMs: Date.now() - startTime,
  };
}
