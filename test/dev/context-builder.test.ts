import { describe, it, expect, vi, beforeAll } from "vitest";
import type { StackProfile } from "../../src/dev/stack-detector.js";

// Set AMEM_DB so context-builder skips the fs.existsSync check and uses mocked createDatabase
beforeAll(() => { process.env.AMEM_DB = "/tmp/test-memory.db"; });

vi.mock("@aman_asmuei/amem-core", () => ({
  createDatabase: vi.fn(() => ({ close: vi.fn() })),
  recall: vi.fn(async () => ({
    memories: [
      { id: "1", content: "In go fiber projects, use fmt.Errorf for error wrapping", type: "pattern", confidence: 0.9 },
      { id: "2", content: "test-app: chose PostgreSQL over MySQL for go backend", type: "decision", confidence: 0.85 },
      { id: "3", content: "In go handlers, never use log.Fatal", type: "correction", confidence: 0.95 },
      { id: "4", content: "For go projects, prefers structured logging with slog", type: "preference", confidence: 0.8 },
    ],
  })),
}));

vi.mock("@aman_asmuei/acore-core", () => ({
  getIdentity: vi.fn(async () => ({
    content: "# Identity\nDeveloper who prefers clean architecture\n",
  })),
}));

// arules-core's listRuleCategories returns { name: string; rules: string[] }
// rules is a flat string[] of active-only rules (disabled rules are already filtered out)
vi.mock("@aman_asmuei/arules-core", () => ({
  listRuleCategories: vi.fn(async () => [
    {
      name: "security",
      rules: ["Never commit secrets or .env files"],
    },
    {
      name: "publishing",
      rules: ["CI/CD only for releases"],
    },
  ]),
}));

import { buildContext } from "../../src/dev/context-builder.js";

const testStack: StackProfile = {
  projectName: "test-app",
  languages: ["go"],
  frameworks: ["fiber"],
  databases: ["postgresql"],
  infra: ["docker"],
  isMonorepo: false,
  detectedAt: Date.now(),
};

describe("buildContext", () => {
  it("assembles all sections from data sources", async () => {
    const ctx = await buildContext(testStack);
    expect(ctx.stack).toBe(testStack);
    expect(ctx.metadata.mode).toBe("template");
    expect(ctx.metadata.memoriesUsed).toBeGreaterThan(0);
  });

  it("separates memories by type", async () => {
    const ctx = await buildContext(testStack);
    expect(ctx.conventions.length).toBeGreaterThan(0);
    expect(ctx.decisions.length).toBeGreaterThan(0);
    expect(ctx.corrections.length).toBeGreaterThan(0);
    expect(ctx.preferences.length).toBeGreaterThan(0);
  });

  it("includes all rules from categories", async () => {
    const ctx = await buildContext(testStack);
    expect(ctx.rules).toContain("Never commit secrets or .env files");
    expect(ctx.rules).toContain("CI/CD only for releases");
  });

  it("returns empty arrays when amem fails", async () => {
    const { recall } = await import("@aman_asmuei/amem-core");
    (recall as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB not found"));
    const ctx = await buildContext(testStack);
    expect(ctx.conventions).toEqual([]);
    expect(ctx.decisions).toEqual([]);
    expect(ctx.corrections).toEqual([]);
  });
});
