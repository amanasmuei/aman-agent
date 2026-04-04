import {
  createDatabase,
  recall,
  buildContext,
  storeMemory,
  consolidateMemories,
  cosineSimilarity,
  preloadEmbeddings,
  buildVectorIndex,
  type AmemDatabase,
  type RecallResult,
  type ContextResult,
  type StoreResult,
  type StoreOptions,
  type ConsolidationReport,
} from "@aman_asmuei/amem-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let db: AmemDatabase | null = null;
let currentProject = "global";

export async function initMemory(project?: string): Promise<AmemDatabase> {
  if (db) return db;

  const amemDir = process.env.AMEM_DIR ?? path.join(os.homedir(), ".amem");
  if (!fs.existsSync(amemDir)) fs.mkdirSync(amemDir, { recursive: true });

  const dbPath = process.env.AMEM_DB ?? path.join(amemDir, "memory.db");
  db = createDatabase(dbPath);
  currentProject = project ?? "global";

  preloadEmbeddings();

  setTimeout(() => {
    try { buildVectorIndex(db!); } catch {}
  }, 1000);

  return db;
}

export function getDb(): AmemDatabase {
  if (!db) throw new Error("Memory not initialized — call initMemory() first");
  return db;
}

export function getProject(): string {
  return currentProject;
}

export async function memoryRecall(query: string, opts?: {
  limit?: number;
  compact?: boolean;
  type?: string;
  tag?: string;
  minConfidence?: number;
  explain?: boolean;
}): Promise<RecallResult> {
  return recall(getDb(), {
    query,
    limit: opts?.limit ?? 10,
    compact: opts?.compact ?? true,
    type: opts?.type,
    tag: opts?.tag,
    minConfidence: opts?.minConfidence,
    explain: opts?.explain,
    scope: currentProject,
  });
}

export async function memoryContext(topic: string, maxTokens?: number): Promise<ContextResult> {
  return buildContext(getDb(), topic, { maxTokens, scope: currentProject });
}

export async function memoryStore(opts: StoreOptions): Promise<StoreResult> {
  return storeMemory(getDb(), opts);
}

export function memoryLog(sessionId: string, role: string, content: string): string {
  return getDb().appendLog({
    sessionId,
    role: role as "user" | "assistant" | "system",
    content,
    project: currentProject,
    metadata: {},
  });
}

export function reminderCheck(): Array<{ id: string; content: string; dueAt: number | null; status: "overdue" | "today" | "upcoming"; scope: string }> {
  return getDb().checkReminders();
}

export function memoryConsolidate(dryRun = false): ConsolidationReport {
  return consolidateMemories(getDb(), cosineSimilarity, {
    dryRun,
    maxStaleDays: 90,
    minConfidence: 0.3,
    minAccessCount: 0,
  });
}

export { type RecallResult, type ContextResult, type StoreResult, type StoreOptions, type ConsolidationReport };
