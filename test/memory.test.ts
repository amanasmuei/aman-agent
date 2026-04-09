import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock database ─────────────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock so the variable is available in factory fns.
const { mockDb } = vi.hoisted(() => {
  const mockDb = { __mock: true } as any;
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
  };
});

// ── Import memory module after mocks are set up ───────────────────────────────
// We init the db via initMemory so getDb() works in subsequent wrapper calls.
import { initMemory, memoryDoctor, memoryRepair, memoryConfig, memoryMultiRecall, memoryReflect, checkReflectionDue } from "../src/memory.js";
import { runDiagnostics, repairDatabase, loadConfig, saveConfig, generateEmbedding, multiStrategyRecall, reflect, isReflectionDue } from "@aman_asmuei/amem-core";

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
