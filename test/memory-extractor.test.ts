import { describe, it, expect } from "vitest";
import { shouldExtract, parseExtractionResult, extractMemories } from "../src/memory-extractor.js";

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
