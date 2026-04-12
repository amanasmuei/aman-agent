import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock delegate (prevents real LLM calls — scheduler imports this directly)
vi.mock("../src/delegate.js", () => ({
  delegateTask: vi.fn(async (task: string, profile: string) => ({
    profile,
    task,
    response: `Done: ${task}`,
    toolsUsed: [],
    turns: 2,
    success: true,
  })),
}));
vi.mock("../src/delegate-remote.js", () => ({ delegateRemote: vi.fn() }));

// Mock decompose (returns a fixed DAG when LLM decomposition path is taken)
vi.mock("../src/orchestrator/decompose.js", () => ({
  decomposeRequirement: vi.fn(async () => ({
    id: "e2e-test",
    name: "E2E Test Feature",
    goal: "Test the full pipeline",
    nodes: [
      { id: "t1", name: "Design", profile: "architect", tier: "advanced", dependencies: [] },
      { id: "t2", name: "Implement", profile: "coder", tier: "standard", dependencies: ["t1"] },
      { id: "t3", name: "Test", profile: "tester", tier: "standard", dependencies: ["t2"] },
      { id: "t4", name: "Review", profile: "reviewer", tier: "standard", dependencies: ["t3"] },
    ],
    gates: [],
  })),
}));

// Mock project detector
vi.mock("../src/project/detector.js", () => ({
  classifyProject: vi.fn(() => ({
    type: "api-backend",
    confidence: 0.9,
    suggestedTemplate: "full-feature",
    suggestedProfiles: ["architect", "coder", "tester", "reviewer"],
    description: "API backend",
  })),
}));

// Mock stack scanner
vi.mock("../src/dev/stack-detector.js", () => ({
  scanStack: vi.fn(() => ({
    projectName: "test-project",
    languages: ["typescript"],
    frameworks: ["express"],
    databases: ["postgresql"],
    infra: ["docker"],
    isMonorepo: false,
    detectedAt: Date.now(),
  })),
}));

// Mock profile auto-install (no filesystem access)
vi.mock("../src/profiles/auto-install.js", () => ({
  ensureAllProfilesInstalled: vi.fn(() => ({
    installed: [],
    skipped: ["architect", "security", "tester", "reviewer"],
  })),
  getProfilesDir: vi.fn(() => "/tmp/test-profiles"),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { smartOrchestrate, createModelRouter } from "../src/orchestrator/index.js";
import { decomposeRequirement } from "../src/orchestrator/decompose.js";
import { delegateTask } from "../src/delegate.js";
import type { LLMClient } from "../src/llm/types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function stubClient(): LLMClient {
  return {
    async chat(_sys, _msgs, onChunk) {
      onChunk({ type: "text", text: "ok" });
      onChunk({ type: "done" });
      return { message: { role: "assistant", content: "ok" }, toolUses: [] };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("E2E: /orchestrate full pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs full pipeline with project detection (template path)", async () => {
    const client = stubClient();
    const router = createModelRouter({ standard: client, advanced: client });

    const result = await smartOrchestrate({
      requirement: "Build a user authentication system",
      client,
      router,
      projectPath: "/tmp/test-project",
      enablePolicyCheck: true,
      enableCostTracking: true,
      enableSelfReview: false, // skip review to keep test fast
    });

    // Pipeline succeeds
    expect(result.orchestration.success).toBe(true);

    // Project detection ran and picked the template
    expect(result.projectType).toBe("api-backend");
    expect(result.templateUsed).toBe("full-feature");

    // Template DAG has 5 nodes (design, implement, review, test, finalize)
    expect(result.dag).toBeDefined();
    expect(result.dag.nodes.length).toBe(5);

    // Decompose was NOT called (template path was taken)
    expect(decomposeRequirement).not.toHaveBeenCalled();

    // delegateTask was called once per node
    expect(delegateTask).toHaveBeenCalledTimes(5);

    // Summary contains completion status
    expect(result.summary).toContain("completed");

    // Cost tracking produced a summary
    expect(result.orchestration.costSummary).toBeDefined();
  });

  it("runs with template override (bug-fix)", async () => {
    const client = stubClient();
    const router = createModelRouter({ standard: client });

    const result = await smartOrchestrate({
      requirement: "Fix login bug",
      client,
      router,
      templateName: "bug-fix",
    });

    expect(result.orchestration.success).toBe(true);
    expect(result.templateUsed).toBe("bug-fix");

    // Bug-fix template has 4 nodes (reproduce, fix, test, review)
    expect(result.dag.nodes.length).toBe(4);
    expect(result.dag.nodes[0].name).toBe("Reproduce");

    // No project detection when template is explicitly provided
    expect(result.projectType).toBeUndefined();

    // Decompose was NOT called (template path was taken)
    expect(decomposeRequirement).not.toHaveBeenCalled();
  });

  it("falls back to LLM decomposition when no template or project path", async () => {
    const client = stubClient();
    const router = createModelRouter({ standard: client, advanced: client });

    const result = await smartOrchestrate({
      requirement: "Build a custom feature",
      client,
      router,
      // no projectPath, no templateName → LLM decomposition
    });

    expect(result.orchestration.success).toBe(true);

    // Decompose WAS called this time
    expect(decomposeRequirement).toHaveBeenCalledWith(
      "Build a custom feature",
      client,
    );

    // DAG came from the mock decomposer (4 nodes)
    expect(result.dag.nodes.length).toBe(4);
    expect(result.dag.id).toBe("e2e-test");

    // No template or project type
    expect(result.templateUsed).toBeUndefined();
    expect(result.projectType).toBeUndefined();
  });

  it("runs with all enterprise features enabled", async () => {
    const client = stubClient();
    const router = createModelRouter({ standard: client, advanced: client });

    const result = await smartOrchestrate({
      requirement: "Build complete feature",
      client,
      router,
      enablePolicyCheck: true,
      enableSelfReview: true,
      enableCostTracking: true,
      budgetLimit: 10.0,
    });

    expect(result.orchestration.success).toBe(true);
    expect(result.orchestration.costSummary).toBeDefined();

    // Self-review ran: the review loop calls delegateTask for 2 review nodes
    // (code-review + test-review), plus 4 from the decomposed DAG = 6 total
    expect(result.orchestration.review).toBeDefined();
    expect(result.orchestration.review!.passed).toBe(true);
  });

  it("fails gracefully when LLM decomposition fails", async () => {
    // Override mock for this test only
    (decomposeRequirement as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("LLM unavailable"),
    );

    const client = stubClient();
    const router = createModelRouter({ standard: client });

    await expect(
      smartOrchestrate({
        requirement: "This will fail",
        client,
        router,
      }),
    ).rejects.toThrow("LLM unavailable");
  });
});
