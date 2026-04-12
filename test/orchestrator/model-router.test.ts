import { describe, it, expect } from "vitest";
import type { LLMClient } from "../../src/llm/types.js";
import type { TaskNode } from "../../src/orchestrator/types.js";
import {
  createModelRouter,
  suggestTier,
  ADVANCED_PROFILES,
  FAST_PROFILES,
} from "../../src/orchestrator/model-router.js";

function stubClient(label: string): LLMClient {
  return {
    async chat(_sys, _msgs, onChunk) {
      onChunk({ type: "text", text: `[${label}]` });
      onChunk({ type: "done" });
      return {
        message: { role: "assistant", content: `[${label}]` },
        toolUses: [],
      };
    },
  };
}

function makeNode(overrides: Partial<TaskNode> & { profile: string }): TaskNode {
  return {
    id: "t1",
    name: "task",
    profile: overrides.profile,
    tier: overrides.tier ?? "standard",
    dependencies: [],
    ...overrides,
  };
}

// ── createModelRouter ───────────────────────────────────────────────
describe("createModelRouter", () => {
  it("returns the correct client for each tier", () => {
    const fast = stubClient("fast");
    const standard = stubClient("standard");
    const advanced = stubClient("advanced");

    const router = createModelRouter({ fast, standard, advanced });

    expect(router.getClient("fast")).toBe(fast);
    expect(router.getClient("standard")).toBe(standard);
    expect(router.getClient("advanced")).toBe(advanced);
  });

  it("falls back to standard when fast tier is missing", () => {
    const standard = stubClient("standard");
    const router = createModelRouter({ standard });

    expect(router.getClient("fast")).toBe(standard);
  });

  it("falls back to standard when advanced tier is missing", () => {
    const standard = stubClient("standard");
    const router = createModelRouter({ standard });

    expect(router.getClient("advanced")).toBe(standard);
  });
});

// ── suggestTier ─────────────────────────────────────────────────────
describe("suggestTier", () => {
  it('returns "advanced" for architect profile', () => {
    expect(suggestTier(makeNode({ profile: "architect" }))).toBe("advanced");
  });

  it('returns "advanced" for planner profile', () => {
    expect(suggestTier(makeNode({ profile: "planner" }))).toBe("advanced");
  });

  it('returns "advanced" for designer profile', () => {
    expect(suggestTier(makeNode({ profile: "designer" }))).toBe("advanced");
  });

  it('returns "fast" for linter profile', () => {
    expect(suggestTier(makeNode({ profile: "linter" }))).toBe("fast");
  });

  it('returns "fast" for formatter profile', () => {
    expect(suggestTier(makeNode({ profile: "formatter" }))).toBe("fast");
  });

  it('returns "fast" for validator profile', () => {
    expect(suggestTier(makeNode({ profile: "validator" }))).toBe("fast");
  });

  it('returns "standard" for coder profile', () => {
    expect(suggestTier(makeNode({ profile: "coder" }))).toBe("standard");
  });

  it('returns "standard" for security profile', () => {
    expect(suggestTier(makeNode({ profile: "security" }))).toBe("standard");
  });
});

// ── Profile sets ────────────────────────────────────────────────────
describe("profile sets", () => {
  it("ADVANCED_PROFILES contains architect, planner, designer", () => {
    expect(ADVANCED_PROFILES).toEqual(
      new Set(["architect", "planner", "designer"]),
    );
  });

  it("FAST_PROFILES contains linter, formatter, validator", () => {
    expect(FAST_PROFILES).toEqual(
      new Set(["linter", "formatter", "validator"]),
    );
  });
});
