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
  runDiagnostics,
  loadConfig,
  saveConfig,
  multiStrategyRecall,
  reflect,
  isReflectionDue,
  type AmemDatabase,
  type RecallResult,
  type ContextResult,
  type StoreResult,
  type StoreOptions,
  type ConsolidationReport,
  type MemoryStats,
  type Memory,
  type DiagnosticReport,
  type ReflectionReport,
  type ReflectionConfig,
  type AmemConfig,
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

  try {
    db = createDatabase(dbPath);
  } catch (err) {
    // Attempt recovery: if DB is corrupted, back it up and create fresh
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, backupPath);
        // Remove WAL/SHM files too
        if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
        if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
        console.error(`[amem] Database corrupted — backed up to ${backupPath}`);
        console.error("[amem] Creating fresh database. Previous memories are in the backup file.");
        db = createDatabase(dbPath);
      } else {
        throw err;
      }
    } catch {
      console.error(`[amem] Failed to initialize memory: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[amem] Try deleting ${amemDir} to reset: rm -rf ${amemDir}`);
      throw err;
    }
  }

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
  const all = getDb().checkReminders();
  return all.filter((r) => r.scope === "global" || r.scope === currentProject);
}

export async function memoryForget(opts: { id?: string; query?: string; type?: string }): Promise<{ deleted: number; message: string }> {
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
  // Type-based delete: delete all memories of a given type
  if (opts.type) {
    const all = db.getAllForProject(currentProject);
    const matches = all.filter((m) => m.type === opts.type);
    if (matches.length === 0) return { deleted: 0, message: `No memories of type "${opts.type}" found.` };
    const vecIdx = getVectorIndex();
    for (const m of matches) {
      db.deleteMemory(m.id);
      if (vecIdx) vecIdx.remove(m.id);
    }
    return { deleted: matches.length, message: `Deleted ${matches.length} "${opts.type}" memories.` };
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
  return { deleted: 0, message: "Provide an id, type, or query to forget." };
}

let _localMemoryConfig: { maxStaleDays?: number; minConfidence?: number; minAccessCount?: number; maxRecallTokens?: number } = {};

export function setMemoryConfig(config: typeof _localMemoryConfig): void {
  _localMemoryConfig = config;
}

export function getMaxRecallTokens(): number {
  return _localMemoryConfig.maxRecallTokens ?? 1500;
}

export function memoryConsolidate(dryRun = false): ConsolidationReport {
  return consolidateMemories(getDb(), cosineSimilarity, {
    dryRun,
    maxStaleDays: _localMemoryConfig.maxStaleDays ?? 90,
    minConfidence: _localMemoryConfig.minConfidence ?? 0.3,
    minAccessCount: _localMemoryConfig.minAccessCount ?? 0,
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
  const all = getDb().getMemoriesSince(since);
  return all.filter((m) => m.scope === "global" || m.scope === currentProject);
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

// ─── Admin: Doctor ───────────────────────────────────────────────────────────

/**
 * Run read-only health diagnostics on the amem database.
 * Returns a structured report with status, stats, and a list of issues.
 */
export async function memoryDoctor(): Promise<DiagnosticReport> {
  return runDiagnostics(getDb());
}

// ─── Admin: Repair ───────────────────────────────────────────────────────────

export interface MemoryRepairResult {
  dryRun: boolean;
  status: "healthy" | "warning" | "critical";
  issues: DiagnosticReport["issues"];
  actions: { action: string; description: string }[];
}

/**
 * Diagnose and optionally repair the memory database.
 * By default runs in dry-run mode — set dryRun:false to apply fixes.
 */
export async function memoryRepair(
  opts: { dryRun?: boolean } = {}
): Promise<MemoryRepairResult> {
  const dryRun = opts.dryRun ?? true;
  const report = runDiagnostics(getDb());
  const actions: { action: string; description: string }[] = [];

  // Surface actionable suggestions from the diagnostic report
  for (const issue of report.issues) {
    actions.push({
      action: issue.type,
      description: dryRun
        ? `[dry-run] Would: ${issue.suggestion}`
        : issue.suggestion,
    });
  }

  return { dryRun, status: report.status, issues: report.issues, actions };
}

// ─── Admin: Config ───────────────────────────────────────────────────────────

/**
 * Read or update the amem configuration.
 * With no args, returns the current config.
 * With updates, deep-merges and saves the new config.
 */
export async function memoryConfig(
  updates?: Partial<AmemConfig>
): Promise<AmemConfig> {
  const current = loadConfig();
  if (updates && Object.keys(updates).length > 0) {
    saveConfig(updates);
    // Return merged view without re-reading from disk (saveConfig merges internally)
    return { ...current, ...updates } as AmemConfig;
  }
  return current;
}

// ─── Advanced Recall ─────────────────────────────────────────────────────────

/**
 * Multi-strategy recall: combines semantic, FTS5, knowledge graph, and
 * temporal scoring into a unified ranked result.
 */
export async function memoryMultiRecall(
  query: string,
  opts: { limit?: number; scope?: string } = {}
) {
  const queryEmbedding = await generateEmbedding(query);
  return multiStrategyRecall(getDb(), {
    query,
    queryEmbedding,
    limit: opts.limit ?? 10,
    scope: opts.scope ?? currentProject ?? undefined,
  });
}

// ─── Reflection ──────────────────────────────────────────────────────────────

/**
 * Run the self-evolving memory reflection engine.
 * Returns clusters, contradictions, and synthesis candidates.
 */
export async function memoryReflect(
  config?: Partial<ReflectionConfig>
): Promise<ReflectionReport> {
  return reflect(getDb(), config);
}

/**
 * Check whether a reflection run is due based on last-run metadata.
 */
export function checkReflectionDue(): { due: boolean; reason: string } {
  return isReflectionDue(getDb());
}
