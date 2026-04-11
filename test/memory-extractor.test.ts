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
    it("parses valid JSON array of candidates (legacy format)", () => {
      const json = JSON.stringify([
        { content: "User prefers TypeScript", type: "preference", tags: ["lang"], confidence: 0.9, scope: "global" },
      ]);
      const result = parseExtractionResult(json);
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe("User prefers TypeScript");
      expect(result.memories[0].type).toBe("preference");
    });

    it("returns empty memories for empty JSON array", () => {
      expect(parseExtractionResult("[]").memories).toEqual([]);
    });

    it("returns empty memories for invalid JSON", () => {
      expect(parseExtractionResult("not json").memories).toEqual([]);
    });

    it("returns empty memories for non-array non-object JSON", () => {
      expect(parseExtractionResult('"just a string"').memories).toEqual([]);
    });

    it("filters out candidates with missing required fields", () => {
      const json = JSON.stringify([
        { content: "valid", type: "preference", tags: [], confidence: 0.8, scope: "global" },
        { content: "", type: "preference", tags: [], confidence: 0.8, scope: "global" },
        { type: "preference", tags: [], confidence: 0.8, scope: "global" },
      ]);
      const result = parseExtractionResult(json);
      expect(result.memories).toHaveLength(1);
    });

    it("extracts JSON from markdown code blocks", () => {
      const wrapped = '```json\n[{"content":"test","type":"fact","tags":[],"confidence":0.8,"scope":"global"}]\n```';
      const result = parseExtractionResult(wrapped);
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe("test");
    });

    it("accepts decision and correction types", () => {
      const json = JSON.stringify([
        { content: "User chose PostgreSQL over MySQL", type: "decision", tags: ["db"], confidence: 0.9, scope: "global" },
        { content: "User corrected: project uses pnpm not npm", type: "correction", tags: ["tooling"], confidence: 0.95, scope: "global" },
      ]);
      const result = parseExtractionResult(json);
      expect(result.memories).toHaveLength(2);
      expect(result.memories[0].type).toBe("decision");
      expect(result.memories[1].type).toBe("correction");
    });

    it("parses new format with memories and sentiment", () => {
      const json = JSON.stringify({
        memories: [
          { content: "User uses pnpm", type: "fact", tags: ["tooling"], confidence: 0.8, scope: "global" },
        ],
        sentiment: { tone: "frustrated", confidence: 0.9, context: "struggling with config" },
      });
      const result = parseExtractionResult(json);
      expect(result.memories).toHaveLength(1);
      expect(result.sentiment).toBeDefined();
      expect(result.sentiment!.tone).toBe("frustrated");
      expect(result.sentiment!.confidence).toBe(0.9);
    });

    it("handles new format with empty memories", () => {
      const json = JSON.stringify({
        memories: [],
        sentiment: { tone: "positive", confidence: 0.7 },
      });
      const result = parseExtractionResult(json);
      expect(result.memories).toHaveLength(0);
      expect(result.sentiment?.tone).toBe("positive");
    });
  });

  describe("extractMemories signature", () => {
    it("accepts 5 parameters (no confirmFn)", () => {
      expect(extractMemories.length).toBeLessThanOrEqual(5);
    });
  });
});

// ── reflect hook integration tests ───────────────────────────────────────────

describe("extractMemories — reflect hook", () => {
  // Import mocked modules — these will resolve to the vi.mock stubs above.
  // We use dynamic imports after mocks are registered so Vitest hoisting works.
  let memoryStore: ReturnType<typeof vi.fn>;
  let memoryRecall: ReturnType<typeof vi.fn>;
  let reflect: ReturnType<typeof vi.fn>;
  let isReflectionDue: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const memMod = await import("../src/memory.js");
    const coreMod = await import("@aman_asmuei/amem-core");
    memoryStore = vi.mocked(memMod.memoryStore);
    memoryRecall = vi.mocked(memMod.memoryRecall);
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
