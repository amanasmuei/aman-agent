import { describe, it, expect, vi, beforeAll } from "vitest";
import type { StackProfile } from "../../src/dev/stack-detector.js";

beforeAll(() => { process.env.AMEM_DB = "/tmp/test-memory.db"; });

vi.mock("@aman_asmuei/amem-core", () => ({
  createDatabase: vi.fn(() => ({ close: vi.fn() })),
  recall: vi.fn(async () => ({
    memories: [
      { id: "1", content: "Use slog for logging", type: "pattern", confidence: 0.9 },
      { id: "2", content: "Chose PostgreSQL", type: "decision", confidence: 0.85 },
    ],
  })),
}));

vi.mock("@aman_asmuei/acore-core", () => ({
  getIdentity: vi.fn(async () => null),
}));

vi.mock("@aman_asmuei/arules-core", () => ({
  listRuleCategories: vi.fn(async () => []),
}));

import { buildContext } from "../../src/dev/context-builder.js";

const testStack: StackProfile = {
  projectName: "test-app",
  languages: ["go"],
  frameworks: ["fiber"],
  databases: ["postgresql"],
  infra: [],
  isMonorepo: false,
  detectedAt: Date.now(),
};

describe("buildContext smart mode", () => {
  it("uses LLM response when smart mode succeeds", async () => {
    const mockClient = {
      chat: vi.fn(async () => ({
        message: {
          content: [{ type: "text", text: "## Conventions\n- Use slog with structured fields\n- Always wrap errors\n\n## Decisions\n- PostgreSQL for all persistence" }],
        },
      })),
    };
    const ctx = await buildContext(testStack, { smart: true, llmClient: mockClient });
    expect(ctx.metadata.mode).toBe("smart");
    expect(mockClient.chat).toHaveBeenCalledOnce();
    // LLM synthesized conventions should be used
    expect(ctx.conventions).toContain("Use slog with structured fields");
  });

  it("falls back to template when LLM fails", async () => {
    const mockClient = {
      chat: vi.fn(async () => { throw new Error("API error"); }),
    };
    const ctx = await buildContext(testStack, { smart: true, llmClient: mockClient });
    expect(ctx.metadata.mode).toBe("template");
    expect(ctx.conventions.length).toBeGreaterThan(0);
  });
});
