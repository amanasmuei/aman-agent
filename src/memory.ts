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
  repairDatabase,
  loadConfig,
  saveConfig,
  multiStrategyRecall,
  reflect,
  isReflectionDue,
  syncFromClaude,
  exportForTeam,
  importFromTeam,
  syncToCopilot,
  MirrorEngine,
  type AmemDatabase,
  type RecallResult,
  type ContextResult,
  type StoreResult,
  type StoreOptions,
  type ConsolidationReport,
  type MemoryStats,
  type Memory,
  type MemoryVersion,
  type MemoryRelation,
  type DiagnosticReport,
  type ReflectionReport,
  type ReflectionConfig,
  type AmemConfig,
  type SyncResult,
  type TeamExportOptions,
  type TeamImportOptions,
  type TeamImportResult,
  type CopilotSyncOptions,
  type CopilotSyncResult,
} from "@aman_asmuei/amem-core";
import { loadConfig as loadAgentConfig, homeDir, expandHome } from "./config.js";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let db: AmemDatabase | null = null;
let mirrorEngine: MirrorEngine | null = null;
let currentProject = "global";

/**
 * Test-only hook: reset the memory module's cached singletons so a
 * subsequent `initMemory()` call picks up a fresh DB and mirror engine.
 * Integration tests use this to exercise different configs within one file.
 */
export function _resetMemoryForTesting(): void {
  db = null;
  mirrorEngine = null;
  currentProject = "global";
}

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

  // Construct the Markdown mirror engine (Task 2.2).
  // Config contract:
  //   - no config file on disk            -> mirror enabled with defaults
  //   - config file with mirror.enabled=false -> mirror disabled (null engine)
  //   - config file with partial mirror block -> Task 2.1's loadConfig merges defaults
  try {
    const agentCfg = loadAgentConfig();
    const mirrorCfg = agentCfg?.mirror;
    const enabled = mirrorCfg?.enabled ?? true;
    if (enabled) {
      const dir = expandHome(mirrorCfg?.dir ?? path.join(homeDir(), "memories"));
      const tiers = mirrorCfg?.tiers ?? ["core", "working", "archival"];
      mirrorEngine = new MirrorEngine(db, {
        dir,
        tiers,
        includeIndex: true,
      });
    }
  } catch (err) {
    // Mirror construction must never break memory init.
    console.warn(`[amem-mirror] construction failed: ${err instanceof Error ? err.message : String(err)}`);
    mirrorEngine = null;
  }

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
  const result = await storeMemory(getDb(), opts);
  // Fire-and-forget mirror write. Null-safe via optional chaining; the
  // engine's internal onError swallows all I/O failures so mirror errors
  // cannot break a memory save. `private` action from the sanitizer means
  // no memory was written, so skip the mirror call in that case.
  if (result.action !== "private" && mirrorEngine) {
    const saved = getDb().getById(result.id);
    if (saved) void mirrorEngine.onSave(saved);
  }
  return result;
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
    void mirrorEngine?.onDelete(fullId, memory.type);
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
      void mirrorEngine?.onDelete(m.id, m.type);
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
      void mirrorEngine?.onDelete(m.id, m.type);
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
  issues: string[];
  actions: string[];
}

/**
 * Diagnose and optionally repair the memory database.
 * By default runs in dry-run mode — set dryRun:false to apply fixes.
 */
export async function memoryRepair(
  opts: { dryRun?: boolean } = {}
): Promise<MemoryRepairResult> {
  const dryRun = opts.dryRun ?? true;
  if (dryRun) {
    // Dry-run: run diagnostics and surface what would be repaired
    const diag = runDiagnostics(getDb());
    return {
      dryRun: true,
      status: diag.status,
      issues: diag.issues.map((issue) => issue.message),
      actions: diag.issues.map((issue) => `Would fix: ${issue.suggestion}`),
    };
  }
  // Actual repair: call repairDatabase with the DB path
  const dbPath = process.env.AMEM_DB ?? path.join(os.homedir(), ".amem", "memory.db");
  const result = repairDatabase(dbPath);
  return {
    dryRun: false,
    status: result.status === "repaired" ? "warning" : result.status === "failed" ? "critical" : "healthy",
    issues: [],
    actions: result.memoriesRecovered > 0 ? [`Recovered ${result.memoriesRecovered} memories`] : [],
  };
}

// ─── Admin: Config ───────────────────────────────────────────────────────────

/**
 * Read or update the amem configuration.
 * With no args, returns the current config.
 * With updates, deep-merges and saves the new config, then returns authoritative post-save state.
 */
export async function memoryConfig(
  updates?: DeepPartial<AmemConfig>
): Promise<AmemConfig> {
  const current = loadConfig();
  if (updates && Object.keys(updates).length > 0) {
    saveConfig(updates as Partial<AmemConfig>);
    return loadConfig(); // read back authoritative merged state
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
): Promise<{ memories: Awaited<ReturnType<typeof multiStrategyRecall>>; total: number }> {
  const queryEmbedding = await generateEmbedding(query);
  const memories = await multiStrategyRecall(getDb(), {
    query,
    queryEmbedding,
    limit: opts.limit ?? 10,
    scope: opts.scope ?? currentProject ?? undefined,
  });
  return { memories, total: memories.length };
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

// ─── Tier ────────────────────────────────────────────────────────────────────

/**
 * Move a memory between tiers: "core" | "working" | "archival".
 */
export function memoryTier(
  id: string,
  tier: string,
): { id: string; tier: string; ok: true } | { ok: false; error: string } {
  try {
    const db = getDb();
    const fullId = db.resolveId(id) ?? id;
    db.updateTier(fullId, tier);
    return { id: fullId, tier, ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Get the full Memory object for a given id. Returns null if not found.
 */
export function memoryDetail(id: string): Memory | null {
  const db = getDb();
  const fullId = db.resolveId(id) ?? id;
  return db.getById(fullId);
}

// ─── Relate ──────────────────────────────────────────────────────────────────

/**
 * Add a knowledge-graph relation between two memories.
 */
export function memoryRelate(
  fromId: string,
  toId: string,
  type: string,
  strength?: number,
): { ok: true; relationId: string } | { ok: false; error: string } {
  try {
    const relationId = getDb().addRelation(fromId, toId, type, strength);
    return { ok: true, relationId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Expire ──────────────────────────────────────────────────────────────────

/**
 * Mark a memory as expired (sets valid_until to now).
 * The optional `reason` string is for caller-side logging only — the db
 * itself stores the timestamp rather than a reason field.
 */
export function memoryExpire(
  id: string,
  reason?: string,
): { ok: true; id: string; reason?: string } | { ok: false; error: string } {
  try {
    const db = getDb();
    const fullId = db.resolveId(id) ?? id;
    db.expireMemory(fullId);
    return { ok: true, id: fullId, ...(reason !== undefined ? { reason } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Versions ────────────────────────────────────────────────────────────────

/**
 * Return the full version history for a memory.
 */
export function memoryVersions(id: string): MemoryVersion[] {
  const db = getDb();
  const fullId = db.resolveId(id) ?? id;
  return db.getVersionHistory(fullId);
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export type MemorySyncAction = "import-claude" | "export-team" | "import-team" | "sync-copilot";

export interface MemorySyncOptions {
  /** For import-claude: filter to a specific project path */
  projectFilter?: string;
  /** For import-claude / export-team: skip actual writes */
  dryRun?: boolean;
  /** For export-team: output directory */
  outputDir?: string;
  /** For export-team: userId identifier in the export manifest */
  userId?: string;
  /** For import-team: path to the JSON export file */
  filePath?: string;
  /** For sync-copilot: options forwarded to syncToCopilot */
  copilotOptions?: CopilotSyncOptions;
  /** For import-team: options forwarded to importFromTeam */
  importOptions?: TeamImportOptions;
}

/**
 * Sync memories with Claude Code auto-memory or team members.
 *
 * Actions:
 * - "import-claude" — read Claude Code memory files and import into amem
 * - "export-team"   — write a shareable JSON export for teammates
 * - "import-team"   — merge a teammate's JSON export into amem
 * - "sync-copilot"  — update the Copilot instructions file from amem memories
 */
export async function memorySync(
  action: MemorySyncAction,
  opts: MemorySyncOptions = {},
): Promise<SyncResult | TeamImportResult | { file: string; count: number } | CopilotSyncResult | { ok: false; error: string }> {
  const db = getDb();
  try {
    switch (action) {
      case "import-claude":
        return await syncFromClaude(db, opts.projectFilter, opts.dryRun ?? false);

      case "export-team": {
        const exportOptions: TeamExportOptions = {
          userId: opts.userId ?? currentProject,
        };
        return await exportForTeam(db, opts.outputDir ?? process.cwd(), exportOptions);
      }

      case "import-team":
        if (!opts.filePath) {
          return { ok: false, error: "filePath is required for import-team" };
        }
        return await importFromTeam(db, opts.filePath, opts.importOptions);

      case "sync-copilot":
        return syncToCopilot(db, opts.copilotOptions);

      default:
        return { ok: false, error: `Unknown sync action: ${action as string}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type { MemoryVersion, MemoryRelation, SyncResult, TeamImportResult, CopilotSyncResult };
