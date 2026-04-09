import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldExtract, parseExtractionResult, extractMemories } from "../src/memory-extractor.js";

// ── Module-level mocks (hoisted by Vitest) ────────────────────────────────────

vi.mock("../src/logger.js", () => ({
  log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../src/skill-engine.js", () => ({
  matchPatternToSkill: vi.fn(() => null),
  enrichSkill: vi.fn(),
}));

const mockDb = { __mock: true } as unknown as import("@aman_asmuei/amem-core").AmemDatabase;

vi.mock("../src/memory.js", () => ({
  memoryRecall: vi.fn(async () => ({ total: 0, memories: [], text: "" })),
  memoryStore: vi.fn(async () => ({
    action: "stored" as const,
    id: "mem-123",
    type: "fact" as const,
    confidence: 0.9,
    tags: [],
    total: 1,
    reinforced: 0,
  })),
  getDb: vi.fn(() => mockDb),
}));

vi.mock("@aman_asmuei/amem-core", () => ({
  autoRelateMemory: vi.fn(() => ({ created: 0, relations: [] })),
  reflect: vi.fn(() => ({
    clusters: [], contradictions: [], synthesisCandidates: [], knowledgeGaps: [],
    orphans: 0, stats: { totalMemories: 0, clusteredMemories: 0, totalClusters: 0,
      avgClusterSize: 0, contradictionsFound: 0, synthesisCandidates: 0,
      knowledgeGaps: 0, healthScore: 1 }, timestamp: Date.now(), durationMs: 0,
  })),
  isReflectionDue: vi.fn(() => ({ due: false, reason: "too soon" })),
}));

describe("memory-extractor", () => {
  describe("shouldExtract", () => {
    it("returns false for short assistant responses", () => {
      expect(shouldExtract("Sure!", 0, 0)).toBe(false);
    });

    it("returns false when last extraction was recent and empty", () => {
      expect(shouldExtract("A longer response with real content here.", 1, 0)).toBe(false);
    });

    it("returns true for substantive response with enough distance", () => {
      expect(shouldExtract("A longer response with real content here that goes on and on.", 5, 0)).toBe(true);
    });

    it("returns true when last extraction produced results with enough content", () => {
      expect(shouldExtract("A longer response with real content here that has enough substance.", 1, 2)).toBe(true);
    });

    it("returns false for short responses even when last extraction had results", () => {
      expect(shouldExtract("Sure!", 1, 2)).toBe(false);
    });
  });

  describe("parseExtractionResult", () => {
    it("parses valid JSON array of candidates", () => {
      const json = JSON.stringify([
        { content: "User prefers TypeScript", type: "preference", tags: ["lang"], confidence: 0.9, scope: "global" },
      ]);
      const result = parseExtractionResult(json);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("User prefers TypeScript");
      expect(result[0].type).toBe("preference");
    });

    it("returns empty array for empty JSON array", () => {
      expect(parseExtractionResult("[]")).toEqual([]);
    });

    it("returns empty array for invalid JSON", () => {
      expect(parseExtractionResult("not json")).toEqual([]);
    });

    it("returns empty array for non-array JSON", () => {
      expect(parseExtractionResult('{"key": "value"}')).toEqual([]);
    });

    it("filters out candidates with missing required fields", () => {
      const json = JSON.stringify([
        { content: "valid", type: "preference", tags: [], confidence: 0.8, scope: "global" },
        { content: "", type: "preference", tags: [], confidence: 0.8, scope: "global" },
        { type: "preference", tags: [], confidence: 0.8, scope: "global" },
      ]);
      const result = parseExtractionResult(json);
      expect(result).toHaveLength(1);
    });

    it("extracts JSON from markdown code blocks", () => {
      const wrapped = '```json\n[{"content":"test","type":"fact","tags":[],"confidence":0.8,"scope":"global"}]\n```';
      const result = parseExtractionResult(wrapped);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("test");
    });

    it("accepts decision and correction types", () => {
      const json = JSON.stringify([
        { content: "User chose PostgreSQL over MySQL", type: "decision", tags: ["db"], confidence: 0.9, scope: "global" },
        { content: "User corrected: project uses pnpm not npm", type: "correction", tags: ["tooling"], confidence: 0.95, scope: "global" },
      ]);
      const result = parseExtractionResult(json);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("decision");
      expect(result[1].type).toBe("correction");
    });
  });

  describe("extractMemories signature", () => {
    it("accepts 5 parameters (no confirmFn)", () => {
      expect(extractMemories.length).toBeLessThanOrEqual(5);
    });
  });
});

// ── autoRelateMemory + reflect hook integration tests ─────────────────────────

describe("extractMemories — autoRelateMemory hook", () => {
  // Import mocked modules — these will resolve to the vi.mock stubs above.
  // We use dynamic imports after mocks are registered so Vitest hoisting works.
  let memoryStore: ReturnType<typeof vi.fn>;
  let memoryRecall: ReturnType<typeof vi.fn>;
  let autoRelateMemory: ReturnType<typeof vi.fn>;
  let reflect: ReturnType<typeof vi.fn>;
  let isReflectionDue: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const memMod = await import("../src/memory.js");
    const coreMod = await import("@aman_asmuei/amem-core");
    memoryStore = vi.mocked(memMod.memoryStore);
    memoryRecall = vi.mocked(memMod.memoryRecall);
    autoRelateMemory = vi.mocked(coreMod.autoRelateMemory);
    reflect = vi.mocked(coreMod.reflect);
    isReflectionDue = vi.mocked(coreMod.isReflectionDue);
  });

  function makeLLMClient(response: string) {
    return {
      chat: vi.fn(async (_sys: string, _msgs: unknown[], onChunk: (c: { type: string; text?: string }) => void) => {
        onChunk({ type: "text", text: response });
      }),
    } as unknown as import("../src/llm/types.js").LLMClient;
  }

  const validCandidate = JSON.stringify([
    { content: "User prefers functional style", type: "preference", tags: ["style"], confidence: 0.9, scope: "global" },
  ]);

  it("calls autoRelateMemory with the stored id when store succeeds", async () => {
    memoryStore.mockResolvedValueOnce({
      action: "stored", id: "mem-abc", type: "preference", confidence: 0.9, tags: [], total: 1, reinforced: 0,
    });
    isReflectionDue.mockReturnValue({ due: false, reason: "too soon" });

    const state = { turnsSinceLastExtraction: 5, lastExtractionCount: 0 };
    const client = makeLLMClient(validCandidate);

    await extractMemories("user msg", "A longer assistant response that has enough substance to trigger extraction.", client, state);

    expect(autoRelateMemory).toHaveBeenCalledOnce();
    expect(autoRelateMemory).toHaveBeenCalledWith(expect.any(Object), "mem-abc");
  });

  it("does NOT call autoRelateMemory when action is private (nothing actually stored)", async () => {
    memoryStore.mockResolvedValueOnce({
      action: "private", id: "mem-xyz", type: "preference", confidence: 0.9, tags: [], total: 0, reinforced: 0,
    });
    isReflectionDue.mockReturnValue({ due: false, reason: "too soon" });

    const state = { turnsSinceLastExtraction: 5, lastExtractionCount: 0 };
    const client = makeLLMClient(validCandidate);

    await extractMemories("user msg", "A longer assistant response that has enough substance to trigger extraction.", client, state);

    expect(autoRelateMemory).not.toHaveBeenCalled();
  });

  it("calls reflect when isReflectionDue returns true and something was stored", async () => {
    memoryStore.mockResolvedValueOnce({
      action: "stored", id: "mem-def", type: "fact", confidence: 0.9, tags: [], total: 5, reinforced: 0,
    });
    isReflectionDue.mockReturnValue({ due: true, reason: "enough new memories" });

    const state = { turnsSinceLastExtraction: 5, lastExtractionCount: 0 };
    const client = makeLLMClient(validCandidate);

    await extractMemories("user msg", "A longer assistant response that has enough substance to trigger extraction.", client, state);

    expect(reflect).toHaveBeenCalledOnce();
    expect(reflect).toHaveBeenCalledWith(expect.any(Object));
  });

  it("does NOT call reflect when isReflectionDue returns false", async () => {
    memoryStore.mockResolvedValueOnce({
      action: "stored", id: "mem-ghi", type: "fact", confidence: 0.9, tags: [], total: 2, reinforced: 0,
    });
    isReflectionDue.mockReturnValue({ due: false, reason: "too soon" });

    const state = { turnsSinceLastExtraction: 5, lastExtractionCount: 0 };
    const client = makeLLMClient(validCandidate);

    await extractMemories("user msg", "A longer assistant response that has enough substance to trigger extraction.", client, state);

    expect(reflect).not.toHaveBeenCalled();
  });

  it("does NOT call reflect when nothing was stored (storedCount is 0)", async () => {
    // LLM returns empty array → nothing to store
    isReflectionDue.mockReturnValue({ due: true, reason: "enough memories" });

    const state = { turnsSinceLastExtraction: 5, lastExtractionCount: 0 };
    const client = makeLLMClient("[]");

    await extractMemories("user msg", "A longer assistant response that has enough substance to trigger extraction.", client, state);

    expect(reflect).not.toHaveBeenCalled();
  });
});
