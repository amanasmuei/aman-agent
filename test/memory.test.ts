import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock database ─────────────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock so the variable is available in factory fns.
const { mockDb } = vi.hoisted(() => {
  const mockDb: any = {
    __mock: true,
    updateTier: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    addRelation: vi.fn().mockReturnValue("relation-uuid"),
    expireMemory: vi.fn(),
    getVersionHistory: vi.fn().mockReturnValue([]),
    resolveId: vi.fn((id: string) => id),
  };
  return { mockDb };
});

vi.mock("better-sqlite3", () => ({
  default: vi.fn(() => mockDb),
}));

// ── Mock amem-core BEFORE importing memory.ts ─────────────────────────────────
vi.mock("@aman_asmuei/amem-core", async () => {
  const actual = await vi.importActual<typeof import("@aman_asmuei/amem-core")>(
    "@aman_asmuei/amem-core"
  );
  return {
    ...actual,
    createDatabase: vi.fn().mockReturnValue(mockDb),
    preloadEmbeddings: vi.fn(),
    buildVectorIndex: vi.fn(),
    // Doctor
    runDiagnostics: vi.fn().mockReturnValue({
      status: "healthy" as const,
      stats: {
        totalMemories: 5,
        embeddingCoverage: 100,
        coreTierTokens: 0,
        coreTierBudget: 500,
        staleCount: 0,
        orphanedGraphNodes: 0,
        byType: {},
        graphEdges: 0,
        remindersOverdue: 0,
      },
      issues: [],
    }),
    // Repair
    repairDatabase: vi.fn().mockReturnValue({
      status: "healthy",
      integrityCheck: "ok",
      backupUsed: null,
      memoriesRecovered: 5,
      message: "Database is healthy (5 memories).",
    }),
    // Config — synchronous in amem-core
    loadConfig: vi.fn().mockReturnValue({ consolidation: { maxStaleDays: 90 } }),
    saveConfig: vi.fn().mockReturnValue(undefined),
    resetConfigCache: vi.fn(),
    // Multi-strategy recall
    generateEmbedding: vi.fn().mockResolvedValue(null),
    multiStrategyRecall: vi.fn().mockResolvedValue([]),
    // Reflection
    reflect: vi.fn().mockReturnValue({
      clusters: [],
      contradictions: [],
      synthesisCandidates: [],
      knowledgeGaps: [],
      orphans: 0,
      stats: {
        totalMemories: 0,
        clusteredMemories: 0,
        totalClusters: 0,
        avgClusterSize: 0,
        contradictionsFound: 0,
        synthesisCandidates: 0,
        knowledgeGaps: 0,
        healthScore: 1,
      },
      timestamp: Date.now(),
      durationMs: 0,
    }),
    isReflectionDue: vi.fn().mockReturnValue({ due: false, reason: "too soon" }),
    // Sync
    syncFromClaude: vi.fn().mockResolvedValue({ imported: 3, skipped: 1, updated: 0, details: [], projectsScanned: 1 }),
    exportForTeam: vi.fn().mockResolvedValue({ file: "/tmp/team-export.json", count: 5 }),
    importFromTeam: vi.fn().mockResolvedValue({ imported: 2, skipped: 0, from: "/tmp/mem.json" }),
    syncToCopilot: vi.fn().mockReturnValue({ file: ".github/copilot-instructions.md", memoriesExported: 4, sections: { corrections: 0, decisions: 0, preferences: 0, patterns: 0, other: 4 }, dryRun: false }),
  };
});

// ── Import memory module after mocks are set up ───────────────────────────────
// We init the db via initMemory so getDb() works in subsequent wrapper calls.
import { initMemory, memoryDoctor, memoryRepair, memoryConfig, memoryMultiRecall, memoryReflect, checkReflectionDue, memoryTier, memoryDetail, memoryRelate, memoryExpire, memoryVersions, memorySync } from "../src/memory.js";
import { runDiagnostics, loadConfig, saveConfig, generateEmbedding, multiStrategyRecall, reflect, isReflectionDue, syncFromClaude, exportForTeam, importFromTeam, syncToCopilot } from "@aman_asmuei/amem-core";

// Bootstrap: init memory once so getDb() doesn't throw.
// The mocked createDatabase returns mockDb, so no real FS access happens.
await initMemory("test-project");

describe("memoryDoctor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls runDiagnostics with the db and returns the report", async () => {
    vi.mocked(runDiagnostics).mockReturnValueOnce({
      status: "healthy",
      stats: { totalMemories: 5, embeddingCoverage: 100, coreTierTokens: 0, coreTierBudget: 500, staleCount: 0, orphanedGraphNodes: 0, byType: {}, graphEdges: 0, remindersOverdue: 0 },
      issues: [],
    });
    const result = await memoryDoctor();
    expect(runDiagnostics).toHaveBeenCalledOnce();
    expect(runDiagnostics).toHaveBeenCalledWith(mockDb);
    expect(result).toMatchObject({ status: "healthy", issues: [] });
  });
});

describe("memoryRepair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runDiagnostics).mockReturnValue({
      status: "healthy",
      stats: { totalMemories: 5, embeddingCoverage: 100, coreTierTokens: 0, coreTierBudget: 500, staleCount: 0, orphanedGraphNodes: 0, byType: {}, graphEdges: 0, remindersOverdue: 0 },
      issues: [],
    });
  });

  it("returns a dry-run report by default", async () => {
    const result = await memoryRepair();
    expect(result).toMatchObject({ dryRun: true });
  });

  it("returns dryRun:false when explicitly disabled", async () => {
    const result = await memoryRepair({ dryRun: false });
    expect(result).toMatchObject({ dryRun: false });
  });

  it("runs diagnostics as part of repair", async () => {
    await memoryRepair();
    expect(runDiagnostics).toHaveBeenCalledWith(mockDb);
  });
});

describe("memoryConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ consolidation: { maxStaleDays: 90 } } as any);
  });

  it("returns current config when called with no args", async () => {
    const result = await memoryConfig();
    expect(loadConfig).toHaveBeenCalledOnce();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(result).toMatchObject({ consolidation: { maxStaleDays: 90 } });
  });

  it("saves config and returns merged config when updates are provided", async () => {
    // After save, loadConfig should return the merged state
    vi.mocked(loadConfig)
      .mockReturnValueOnce({ consolidation: { maxStaleDays: 90 } } as any)
      .mockReturnValueOnce({ consolidation: { maxStaleDays: 60 } } as any);
    const result = await memoryConfig({ consolidation: { maxStaleDays: 60 } });
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ consolidation: { maxStaleDays: 60 } });
  });

  it("does not call saveConfig when updates object is empty", async () => {
    await memoryConfig({});
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

describe("memoryMultiRecall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateEmbedding).mockResolvedValue(null);
    vi.mocked(multiStrategyRecall).mockResolvedValue([]);
  });

  it("generates an embedding and calls multiStrategyRecall with the query", async () => {
    const result = await memoryMultiRecall("test query");
    expect(generateEmbedding).toHaveBeenCalledWith("test query");
    expect(multiStrategyRecall).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ query: "test query" })
    );
    expect(result).toEqual({ memories: [], total: 0 });
  });

  it("passes limit option through to multiStrategyRecall", async () => {
    await memoryMultiRecall("test query", { limit: 5 });
    expect(multiStrategyRecall).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ limit: 5 })
    );
  });
});

describe("memoryReflect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reflect).mockReturnValue({
      clusters: [],
      contradictions: [],
      synthesisCandidates: [],
      knowledgeGaps: [],
      orphans: 0,
      stats: { totalMemories: 0, clusteredMemories: 0, totalClusters: 0, avgClusterSize: 0, contradictionsFound: 0, synthesisCandidates: 0, knowledgeGaps: 0, healthScore: 1 },
      timestamp: Date.now(),
      durationMs: 0,
    });
  });

  it("calls reflect with the db and returns the report", async () => {
    const result = await memoryReflect();
    expect(reflect).toHaveBeenCalledOnce();
    expect(reflect).toHaveBeenCalledWith(mockDb, undefined);
    expect(result).toMatchObject({ clusters: [], contradictions: [] });
  });

  it("passes config options through when provided", async () => {
    await memoryReflect({ minClusterSize: 5 });
    expect(reflect).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ minClusterSize: 5 })
    );
  });
});

describe("checkReflectionDue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isReflectionDue).mockReturnValue({ due: false, reason: "too soon" });
  });

  it("calls isReflectionDue with the db and returns the result", () => {
    const result = checkReflectionDue();
    expect(isReflectionDue).toHaveBeenCalledWith(mockDb);
    expect(result).toMatchObject({ due: false, reason: "too soon" });
  });
});

// ── New wrapper tests ─────────────────────────────────────────────────────────

describe("memoryTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.updateTier = vi.fn();
    mockDb.resolveId = vi.fn((id: string) => id);
  });

  it("calls updateTier on the db and returns { id, tier, ok: true }", () => {
    const result = memoryTier("mem-001", "core");
    expect(mockDb.updateTier).toHaveBeenCalledWith("mem-001", "core");
    expect(result).toEqual({ id: "mem-001", tier: "core", ok: true });
  });

  it("returns { ok: false } when updateTier throws", () => {
    mockDb.updateTier = vi.fn().mockImplementation(() => { throw new Error("db error"); });
    const result = memoryTier("mem-001", "core");
    expect(result).toMatchObject({ ok: false });
  });
});

describe("memoryDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.resolveId = vi.fn((id: string) => id);
  });

  it("returns the memory object when found", () => {
    const fakeMemory = { id: "mem-001", content: "test content", type: "fact" };
    mockDb.getById = vi.fn().mockReturnValue(fakeMemory);
    const result = memoryDetail("mem-001");
    expect(mockDb.getById).toHaveBeenCalledWith("mem-001");
    expect(result).toEqual(fakeMemory);
  });

  it("returns null when memory is not found", () => {
    mockDb.getById = vi.fn().mockReturnValue(null);
    const result = memoryDetail("mem-999");
    expect(result).toBeNull();
  });
});

describe("memoryRelate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.addRelation = vi.fn().mockReturnValue("relation-uuid-123");
  });

  it("calls addRelation and returns { ok: true, relationId }", () => {
    const result = memoryRelate("mem-001", "mem-002", "supports");
    expect(mockDb.addRelation).toHaveBeenCalledWith("mem-001", "mem-002", "supports", undefined);
    expect(result).toEqual({ ok: true, relationId: "relation-uuid-123" });
  });

  it("passes optional strength parameter through", () => {
    memoryRelate("mem-001", "mem-002", "contradicts", 0.5);
    expect(mockDb.addRelation).toHaveBeenCalledWith("mem-001", "mem-002", "contradicts", 0.5);
  });

  it("returns { ok: false } when addRelation throws", () => {
    mockDb.addRelation = vi.fn().mockImplementation(() => { throw new Error("db error"); });
    const result = memoryRelate("mem-001", "mem-002", "supports");
    expect(result).toMatchObject({ ok: false });
  });
});

describe("memoryExpire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.expireMemory = vi.fn();
    mockDb.resolveId = vi.fn((id: string) => id);
  });

  it("calls expireMemory on the db and returns { ok: true }", () => {
    const result = memoryExpire("mem-001", "outdated");
    expect(mockDb.expireMemory).toHaveBeenCalledWith("mem-001");
    expect(result).toMatchObject({ ok: true, id: "mem-001" });
  });

  it("returns { ok: false } when expireMemory throws", () => {
    mockDb.expireMemory = vi.fn().mockImplementation(() => { throw new Error("db error"); });
    const result = memoryExpire("mem-001");
    expect(result).toMatchObject({ ok: false });
  });
});

describe("memoryVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.resolveId = vi.fn((id: string) => id);
  });

  it("returns an array of version history entries", () => {
    const fakeVersions = [
      { versionId: "v1", memoryId: "mem-001", content: "old content", confidence: 0.8, editedAt: 1000, reason: "patch" },
    ];
    mockDb.getVersionHistory = vi.fn().mockReturnValue(fakeVersions);
    const result = memoryVersions("mem-001");
    expect(mockDb.getVersionHistory).toHaveBeenCalledWith("mem-001");
    expect(result).toEqual(fakeVersions);
  });

  it("returns an empty array when no history exists", () => {
    mockDb.getVersionHistory = vi.fn().mockReturnValue([]);
    const result = memoryVersions("mem-001");
    expect(result).toEqual([]);
  });
});

describe("memorySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(syncFromClaude).mockResolvedValue({ imported: 3, skipped: 1, updated: 0, details: [], projectsScanned: 1 });
    vi.mocked(exportForTeam).mockResolvedValue({ file: "/tmp/team-export.json", count: 5 });
    vi.mocked(importFromTeam).mockResolvedValue({ imported: 2, skipped: 0, from: "/tmp/mem.json" });
    vi.mocked(syncToCopilot).mockReturnValue({ file: ".github/copilot-instructions.md", memoriesExported: 4, sections: { corrections: 0, decisions: 0, preferences: 0, patterns: 0, other: 4 }, dryRun: false });
  });

  it("import-claude action calls syncFromClaude and returns result", async () => {
    const result = await memorySync("import-claude");
    expect(syncFromClaude).toHaveBeenCalledWith(mockDb, undefined, false);
    expect(result).toMatchObject({ imported: 3, skipped: 1 });
  });

  it("import-claude passes dryRun option", async () => {
    await memorySync("import-claude", { dryRun: true });
    expect(syncFromClaude).toHaveBeenCalledWith(mockDb, undefined, true);
  });

  it("export-team action calls exportForTeam and returns result", async () => {
    const result = await memorySync("export-team", { outputDir: "/tmp", userId: "my-proj" });
    expect(exportForTeam).toHaveBeenCalledWith(mockDb, "/tmp", expect.objectContaining({ userId: "my-proj" }));
    expect(result).toMatchObject({ file: "/tmp/team-export.json", count: 5 });
  });

  it("import-team action calls importFromTeam and returns result", async () => {
    const result = await memorySync("import-team", { filePath: "/tmp/mem.json" });
    expect(importFromTeam).toHaveBeenCalledWith(mockDb, "/tmp/mem.json", undefined);
    expect(result).toMatchObject({ imported: 2 });
  });

  it("sync-copilot action calls syncToCopilot and returns result", async () => {
    const result = await memorySync("sync-copilot");
    expect(syncToCopilot).toHaveBeenCalledWith(mockDb, undefined);
    expect(result).toMatchObject({ file: ".github/copilot-instructions.md" });
  });

  it("returns { ok: false } for unknown action", async () => {
    const result = await memorySync("unknown-action" as any);
    expect(result).toMatchObject({ ok: false });
  });
});
