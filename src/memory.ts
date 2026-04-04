import {
  createDatabase,
  recall,
  buildContext,
  storeMemory,
  consolidateMemories,
  cosineSimilarity,
  preloadEmbeddings,
  buildVectorIndex,
  recallMemories,
  generateEmbedding,
  getVectorIndex,
  type AmemDatabase,
  type RecallResult,
  type ContextResult,
  type StoreResult,
  type StoreOptions,
  type ConsolidationReport,
  type MemoryStats,
  type Memory,
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

export async function memoryForget(opts: { id?: string; query?: string }): Promise<{ deleted: number; message: string }> {
  const db = getDb();
  if (opts.id) {
    const fullId = db.resolveId(opts.id) ?? opts.id;
    const memory = db.getById(fullId);
    if (!memory) return { deleted: 0, message: `Memory ${opts.id} not found.` };
    db.deleteMemory(fullId);
    const vecIdx = getVectorIndex();
    if (vecIdx) vecIdx.remove(fullId);
    return { deleted: 1, message: `Deleted: "${memory.content}" (${memory.type})` };
  }
  if (opts.query) {
    const queryEmbedding = await generateEmbedding(opts.query);
    const matches = recallMemories(db, { query: opts.query, queryEmbedding, limit: 50, minConfidence: 0, scope: currentProject });
    if (matches.length === 0) return { deleted: 0, message: `No memories found matching "${opts.query}".` };
    const vecIdx = getVectorIndex();
    for (const m of matches) {
      db.deleteMemory(m.id);
      if (vecIdx) vecIdx.remove(m.id);
    }
    return { deleted: matches.length, message: `Deleted ${matches.length} memories matching "${opts.query}".` };
  }
  return { deleted: 0, message: "Provide an id or query to forget." };
}

export function memoryConsolidate(dryRun = false): ConsolidationReport {
  return consolidateMemories(getDb(), cosineSimilarity, {
    dryRun,
    maxStaleDays: 90,
    minConfidence: 0.3,
    minAccessCount: 0,
  });
}

export function isMemoryInitialized(): boolean {
  return db !== null;
}

export function memoryStats(): MemoryStats {
  return getDb().getStats();
}

export function memoryExport(): Memory[] {
  return getDb().getAllForProject(currentProject);
}

export function memorySince(hours: number): Memory[] {
  const since = Date.now() - hours * 60 * 60 * 1000;
  return getDb().getMemoriesSince(since);
}

export function memorySearch(query: string, limit?: number): Memory[] {
  return getDb().fullTextSearch(query, limit, currentProject);
}

export function reminderSet(content: string, dueAt?: number): string {
  return getDb().insertReminder(content, dueAt ?? null, currentProject);
}

export function reminderList(includeCompleted?: boolean): Array<{ id: string; content: string; dueAt: number | null; completed: boolean; createdAt: number; scope: string }> {
  return getDb().listReminders(includeCompleted, currentProject);
}

export function reminderComplete(id: string): boolean {
  const fullId = getDb().resolveReminderId(id) ?? id;
  return getDb().completeReminder(fullId);
}

export { type RecallResult, type ContextResult, type StoreResult, type StoreOptions, type ConsolidationReport, type MemoryStats, type Memory };
