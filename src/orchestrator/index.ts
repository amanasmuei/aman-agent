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

// Re-exports: review loop
export {
  buildReviewDAG,
  runReviewLoop,
  type ReviewLoopOptions,
  type ReviewResult,
} from "./review-loop.js";

// Re-exports: circuit breaker
export {
  createCircuitBreaker,
  createCircuitBreakerRegistry,
  type CircuitState,
  type CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitBreakerRegistry,
} from "./circuit-breaker.js";

// Re-exports: checkpoint
export {
  createCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
  restoreMaps,
  type CheckpointData,
} from "./checkpoint.js";

// Re-exports: cost tracker
export {
  createCostTracker,
  DEFAULT_TIER_COSTS,
  type CostTracker,
  type CostTrackerOptions,
  type CostEntry,
  type TierCost,
} from "./cost-tracker.js";

// Re-exports: policy
export {
  evaluatePolicy,
  getDefaultPolicies,
  formatPolicyResult,
  type PolicySeverity,
  type PolicyViolation,
  type PolicyResult,
  type PolicyRule,
} from "./policy.js";

// Re-exports: templates
export {
  fullFeatureTemplate,
  bugFixTemplate,
  securityAuditTemplate,
  getTemplate,
  listTemplates,
  type TemplateOptions,
} from "./templates/index.js";

// ── Convenience functions ───────────────────────────────────────────

import type { TaskDAG, TaskNode, PhaseGate, OrchestrationState } from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { SchedulerCallbacks, SchedulerResult } from "./scheduler.js";
import { validateDAG } from "./dag.js";
import { createOrchestrationState } from "./state-machine.js";
import { runScheduler } from "./scheduler.js";

/**
 * Formats a TaskDAG for human-readable CLI display.
 */
export function formatDAGForDisplay(dag: TaskDAG): string {
  const lines: string[] = [];
  lines.push(`## ${dag.name}`);
  lines.push(`**Goal:** ${dag.goal}`);
  lines.push(`**Tasks:** ${dag.nodes.length} | **Gates:** ${dag.gates.length}`);
  lines.push("");

  for (const node of dag.nodes) {
    const depLabel =
      node.dependencies.length === 0
        ? "(root)"
        : `(after: ${node.dependencies.join(", ")})`;
    lines.push(`- **${node.name}** \u2192 ${node.profile} [${node.tier}] ${depLabel}`);
  }

  for (const gate of dag.gates) {
    lines.push(`- \uD83D\uDD12 **${gate.name}** [${gate.type}]`);
  }

  return lines.join("\n");
}

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
