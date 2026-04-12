import { z } from "zod";

// ── Model Tiers ──────────────────────────────────────────────────────
export const ModelTierEnum = z.enum(["fast", "standard", "advanced"]);
export type ModelTier = z.infer<typeof ModelTierEnum>;

// ── TaskNode — a single unit of work in the DAG ─────────────────────
export const TaskNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  profile: z.string().min(1),
  tier: ModelTierEnum,
  dependencies: z.array(z.string()).default([]),
  phase: z.string().optional(),
  context: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

// ── PhaseGate — a gate between phases ────────────────────────────────
export const PhaseGateTypeEnum = z.enum([
  "approval",
  "ci_pass",
  "test_pass",
  "custom",
]);
export type PhaseGateType = z.infer<typeof PhaseGateTypeEnum>;

export const PhaseGateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: PhaseGateTypeEnum,
  afterNodes: z.array(z.string()),
  beforeNodes: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});
export type PhaseGate = z.infer<typeof PhaseGateSchema>;

// ── TaskDAG — the complete directed acyclic graph ────────────────────
export const TaskDAGSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().min(1),
  nodes: z.array(TaskNodeSchema).min(1),
  gates: z.array(PhaseGateSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskDAG = z.infer<typeof TaskDAGSchema>;

// ── OrchestrationStatus ──────────────────────────────────────────────
export const OrchestrationStatusEnum = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "approved",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type OrchestrationStatus = z.infer<typeof OrchestrationStatusEnum>;

// ── TaskStatus ───────────────────────────────────────────────────────
export const TaskStatusEnum = z.enum([
  "pending",
  "ready",
  "running",
  "completed",
  "failed",
  "skipped",
  "blocked",
]);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

// ── TaskResult (plain TS — no Zod) ──────────────────────────────────
export interface TaskResult {
  nodeId: string;
  status: TaskStatus;
  output?: string;
  error?: string;
  toolsUsed: string[];
  turns: number;
  startedAt: number;
  completedAt?: number;
  tier: ModelTier;
}

// ── OrchestrationState (plain TS — uses Maps) ───────────────────────
export interface OrchestrationState {
  dag: TaskDAG;
  status: OrchestrationStatus;
  taskStatuses: Map<string, TaskStatus>;
  taskResults: Map<string, TaskResult>;
  activeGate: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

// ── OrchestrationConfig ──────────────────────────────────────────────
export const OrchestrationConfigSchema = z.object({
  maxParallelTasks: z.number().int().positive().default(4),
  defaultTier: ModelTierEnum.default("standard"),
  requireApprovalForPhaseTransition: z.boolean().default(true),
  taskTimeoutMs: z.number().int().positive().default(300_000),
  orchestrationTimeoutMs: z.number().int().positive().default(3_600_000),
});
export type OrchestrationConfig = z.infer<typeof OrchestrationConfigSchema>;
