import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  TaskDAG,
  TaskResult,
  OrchestrationStatus,
  TaskStatus,
} from "./types.js";

// ── CheckpointData ──────────────────────────────────────────────────────
export interface CheckpointData {
  version: number;
  orchestrationId: string;
  dag: TaskDAG;
  status: OrchestrationStatus;
  taskStatuses: Record<string, TaskStatus>;
  taskResults: Record<string, TaskResult>;
  resolvedGates: string[];
  activeGate: string | null;
  startedAt: number;
  updatedAt: number;
  checkpointedAt: number;
}

/**
 * Serialize orchestration state to a checkpoint.
 */
export function createCheckpoint(
  orchestrationId: string,
  dag: TaskDAG,
  status: OrchestrationStatus,
  taskStatuses: Map<string, TaskStatus>,
  taskResults: Map<string, TaskResult>,
  resolvedGates: Set<string>,
  activeGate: string | null,
  startedAt: number,
): CheckpointData {
  const now = Date.now();
  return {
    version: 1,
    orchestrationId,
    dag,
    status,
    taskStatuses: Object.fromEntries(taskStatuses),
    taskResults: Object.fromEntries(taskResults),
    resolvedGates: [...resolvedGates],
    activeGate,
    startedAt,
    updatedAt: now,
    checkpointedAt: now,
  };
}

/**
 * Serialize checkpoint to JSON string.
 */
export function serializeCheckpoint(checkpoint: CheckpointData): string {
  return JSON.stringify(checkpoint);
}

/**
 * Deserialize JSON string to checkpoint.
 */
export function deserializeCheckpoint(json: string): CheckpointData {
  return JSON.parse(json) as CheckpointData;
}

/**
 * Save checkpoint to a file.
 * Writes to dir/checkpoint-{orchestrationId}.json.
 * Returns the file path.
 */
export async function saveCheckpoint(
  checkpoint: CheckpointData,
  dir: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `checkpoint-${checkpoint.orchestrationId}.json`);
  await writeFile(filePath, serializeCheckpoint(checkpoint), "utf-8");
  return filePath;
}

/**
 * Load checkpoint from a file.
 * Returns null if the file does not exist.
 */
export async function loadCheckpoint(
  orchestrationId: string,
  dir: string,
): Promise<CheckpointData | null> {
  const filePath = join(dir, `checkpoint-${orchestrationId}.json`);
  try {
    const json = await readFile(filePath, "utf-8");
    return deserializeCheckpoint(json);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Restore Maps and Sets from checkpoint data.
 */
export function restoreMaps(checkpoint: CheckpointData): {
  taskStatuses: Map<string, TaskStatus>;
  taskResults: Map<string, TaskResult>;
  resolvedGates: Set<string>;
} {
  return {
    taskStatuses: new Map(Object.entries(checkpoint.taskStatuses)),
    taskResults: new Map(Object.entries(checkpoint.taskResults)),
    resolvedGates: new Set(checkpoint.resolvedGates),
  };
}
