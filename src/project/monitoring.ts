export interface PhaseMetrics {
  name: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  taskCount: number;
  completedTasks: number;
  failedTasks: number;
}

export interface AgentMetrics {
  profile: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalTurns: number;
  toolsUsed: string[];
  avgTurnsPerTask: number;
}

export interface OrchestrationMetrics {
  orchestrationId: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status: string;
  phases: PhaseMetrics[];
  agents: Map<string, AgentMetrics>;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  approvalGates: number;
  approvedGates: number;
}

/**
 * Create a new metrics tracker.
 */
export function createMetrics(orchestrationId: string): OrchestrationMetrics {
  return {
    orchestrationId,
    startedAt: Date.now(),
    completedAt: undefined,
    durationMs: undefined,
    status: "running",
    phases: [],
    agents: new Map(),
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    approvalGates: 0,
    approvedGates: 0,
  };
}

/**
 * Record a task completion in the metrics.
 */
export function recordTaskCompletion(
  metrics: OrchestrationMetrics,
  profile: string,
  turns: number,
  toolsUsed: string[],
  success: boolean,
): void {
  metrics.totalTasks++;
  if (success) {
    metrics.completedTasks++;
  } else {
    metrics.failedTasks++;
  }

  let agent = metrics.agents.get(profile);
  if (!agent) {
    agent = {
      profile,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalTurns: 0,
      toolsUsed: [],
      avgTurnsPerTask: 0,
    };
    metrics.agents.set(profile, agent);
  }

  if (success) {
    agent.tasksCompleted++;
  } else {
    agent.tasksFailed++;
  }

  agent.totalTurns += turns;

  // Accumulate tools without duplicates
  for (const tool of toolsUsed) {
    if (!agent.toolsUsed.includes(tool)) {
      agent.toolsUsed.push(tool);
    }
  }

  const totalAgentTasks = agent.tasksCompleted + agent.tasksFailed;
  agent.avgTurnsPerTask = totalAgentTasks > 0 ? agent.totalTurns / totalAgentTasks : 0;
}

/**
 * Record a phase start.
 */
export function recordPhaseStart(
  metrics: OrchestrationMetrics,
  phaseName: string,
  taskCount: number,
): void {
  metrics.phases.push({
    name: phaseName,
    startedAt: Date.now(),
    completedAt: undefined,
    durationMs: undefined,
    taskCount,
    completedTasks: 0,
    failedTasks: 0,
  });
}

/**
 * Record a phase completion.
 */
export function recordPhaseCompletion(
  metrics: OrchestrationMetrics,
  phaseName: string,
  completedTasks: number,
  failedTasks: number,
): void {
  const phase = metrics.phases.find((p) => p.name === phaseName);
  if (!phase) return;

  const now = Date.now();
  phase.completedAt = now;
  phase.durationMs = now - phase.startedAt;
  phase.completedTasks = completedTasks;
  phase.failedTasks = failedTasks;
}

/**
 * Record an approval gate.
 */
export function recordApprovalGate(
  metrics: OrchestrationMetrics,
  approved: boolean,
): void {
  metrics.approvalGates++;
  if (approved) {
    metrics.approvedGates++;
  }
}

/**
 * Finalize metrics (set completedAt, calculate duration).
 */
export function finalizeMetrics(
  metrics: OrchestrationMetrics,
  status: string,
): void {
  const now = Date.now();
  metrics.completedAt = now;
  metrics.durationMs = now - metrics.startedAt;
  metrics.status = status;
}

/**
 * Format metrics as a human-readable summary.
 */
export function formatMetrics(metrics: OrchestrationMetrics): string {
  const lines: string[] = [];

  lines.push(`Orchestration: ${metrics.orchestrationId}`);

  const durationStr =
    metrics.durationMs !== undefined
      ? `${(metrics.durationMs / 1000).toFixed(1)}s`
      : "in progress";
  lines.push(`Status: ${metrics.status} | Duration: ${durationStr}`);

  lines.push(
    `Tasks: ${metrics.completedTasks}/${metrics.totalTasks} completed, ${metrics.failedTasks} failed`,
  );

  // Agent summaries
  const agentParts: string[] = [];
  for (const [, agent] of metrics.agents) {
    const totalTasks = agent.tasksCompleted + agent.tasksFailed;
    agentParts.push(
      `${agent.profile} (${totalTasks} task${totalTasks !== 1 ? "s" : ""}, avg ${agent.avgTurnsPerTask} turns)`,
    );
  }
  if (agentParts.length > 0) {
    lines.push(`Agents: ${agentParts.join(", ")}`);
  }

  if (metrics.approvalGates > 0) {
    lines.push(
      `Approval Gates: ${metrics.approvedGates}/${metrics.approvalGates} approved`,
    );
  }

  return lines.join("\n");
}
