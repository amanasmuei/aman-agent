// ── Public API for the orchestrator module ──────────────────────────

// Re-exports: types
export {
  type TaskNode,
  type TaskDAG,
  type PhaseGate,
  type OrchestrationState,
  type OrchestrationConfig,
  type TaskResult,
  type ModelTier,
  TaskNodeSchema,
  TaskDAGSchema,
  PhaseGateSchema,
  OrchestrationConfigSchema,
  OrchestrationStatusEnum,
  TaskStatusEnum,
  ModelTierEnum,
  PhaseGateTypeEnum,
} from "./types.js";

// Re-exports: state machine
export {
  createOrchestrationState,
  transition,
  canTransition,
  getValidTransitions,
  transitionTask,
  InvalidTransitionError,
} from "./state-machine.js";

// Re-exports: DAG
export {
  validateDAG,
  topologicalSort,
  getReadyNodes,
  getDependents,
  DAGValidationError,
} from "./dag.js";

// Re-exports: model router
export {
  createModelRouter,
  suggestTier,
  type ModelRouter,
} from "./model-router.js";

// Re-exports: audit
export {
  createAuditLog,
  recordAuditEvent,
  getAuditTrail,
  formatAuditTrail,
  type AuditLog,
  type AuditEvent,
  type AuditEventType,
} from "./audit.js";

// Re-exports: decompose
export {
  decomposeRequirement,
  parseDecompositionResponse,
} from "./decompose.js";

// Re-exports: scheduler
export {
  runScheduler,
  type SchedulerCallbacks,
  type SchedulerResult,
} from "./scheduler.js";

// ── Convenience functions ───────────────────────────────────────────

import type { TaskDAG, OrchestrationState } from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { SchedulerCallbacks, SchedulerResult } from "./scheduler.js";
import { validateDAG } from "./dag.js";
import { createOrchestrationState } from "./state-machine.js";
import { runScheduler } from "./scheduler.js";

/**
 * Validates DAG (throws DAGValidationError if invalid), then creates
 * initial orchestration state.
 */
export function createOrchestration(dag: TaskDAG): OrchestrationState {
  validateDAG(dag);
  return createOrchestrationState(dag);
}

/**
 * Convenience wrapper: validates DAG and runs the scheduler end-to-end.
 */
export async function runOrchestration(
  dag: TaskDAG,
  router: ModelRouter,
  options?: { maxParallelTasks?: number; taskTimeoutMs?: number },
  callbacks?: SchedulerCallbacks,
): Promise<SchedulerResult> {
  return runScheduler(dag, router, options, callbacks);
}
