import type {
  TaskDAG,
  OrchestrationState,
  OrchestrationStatus,
  TaskStatus,
} from "./types.js";

// ── Transition tables ───────────────────────────────────────────────

const ORCHESTRATION_TRANSITIONS: Record<OrchestrationStatus, OrchestrationStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["awaiting_approval", "paused", "completed", "failed", "cancelled"],
  awaiting_approval: ["approved", "cancelled", "failed"],
  approved: ["running", "cancelled"],
  paused: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "skipped", "blocked"],
  ready: ["running", "skipped", "blocked"],
  running: ["completed", "failed"],
  completed: [],
  failed: ["ready"],
  skipped: [],
  blocked: ["ready", "skipped"],
};

const TERMINAL_ORCHESTRATION: Set<OrchestrationStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

// ── InvalidTransitionError ──────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly entity: string = "orchestration",
  ) {
    super(
      `Invalid ${entity} transition: ${from} → ${to}`,
    );
    this.name = "InvalidTransitionError";
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createOrchestrationState(dag: TaskDAG): OrchestrationState {
  const now = Date.now();
  const taskStatuses = new Map<string, TaskStatus>();
  for (const node of dag.nodes) {
    taskStatuses.set(node.id, "pending");
  }
  return {
    dag,
    status: "pending",
    taskStatuses,
    taskResults: new Map(),
    activeGate: null,
    startedAt: now,
    updatedAt: now,
  };
}

// ── Query helpers ───────────────────────────────────────────────────

export function canTransition(
  state: OrchestrationState,
  to: OrchestrationStatus,
): boolean {
  return ORCHESTRATION_TRANSITIONS[state.status].includes(to);
}

export function getValidTransitions(
  state: OrchestrationState,
): OrchestrationStatus[] {
  return [...ORCHESTRATION_TRANSITIONS[state.status]];
}

// ── Orchestration transition ────────────────────────────────────────

function cloneState(state: OrchestrationState): OrchestrationState {
  return {
    ...state,
    taskStatuses: new Map(state.taskStatuses),
    taskResults: new Map(state.taskResults),
    updatedAt: Date.now(),
  };
}

export function transition(
  state: OrchestrationState,
  to: OrchestrationStatus,
  error?: string,
): OrchestrationState {
  if (!canTransition(state, to)) {
    throw new InvalidTransitionError(state.status, to);
  }

  const next = cloneState(state);
  next.status = to;

  if (TERMINAL_ORCHESTRATION.has(to)) {
    next.completedAt = next.updatedAt;
  }

  if (error !== undefined) {
    next.error = error;
  }

  return next;
}

// ── Task transition ─────────────────────────────────────────────────

export function transitionTask(
  state: OrchestrationState,
  taskId: string,
  to: TaskStatus,
): OrchestrationState {
  const current = state.taskStatuses.get(taskId);
  if (current === undefined) {
    throw new Error(`Unknown task id: ${taskId}`);
  }

  if (!TASK_TRANSITIONS[current].includes(to)) {
    throw new InvalidTransitionError(current, to, "task");
  }

  const next = cloneState(state);
  next.taskStatuses.set(taskId, to);
  return next;
}
