import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskDAG, TaskResult } from "../../src/orchestrator/types.js";
import type { ModelRouter } from "../../src/orchestrator/model-router.js";
import type { SchedulerResult } from "../../src/orchestrator/scheduler.js";

// ── Mocks ───────────────────────────────────────────────────────────

const mockRunScheduler = vi.fn<(...args: any[]) => Promise<SchedulerResult>>();

vi.mock("../../src/orchestrator/scheduler.js", () => ({
  runScheduler: (...args: any[]) => mockRunScheduler(...args),
}));

vi.mock("../../src/delegate.js", () => ({ delegateTask: vi.fn() }));
vi.mock("../../src/delegate-remote.js", () => ({ delegateRemote: vi.fn() }));

import { buildReviewDAG, runReviewLoop } from "../../src/orchestrator/review-loop.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createFakeRouter(): ModelRouter {
  return { getClient: () => ({} as any) };
}

const SAMPLE_DAG: TaskDAG = {
  id: "orch-1",
  name: "Feature Build",
  goal: "Build a feature",
  nodes: [
    { id: "code", name: "Write Code", profile: "coder", tier: "standard", dependencies: [] },
    { id: "test", name: "Write Tests", profile: "tester", tier: "standard", dependencies: ["code"] },
  ],
  gates: [],
};

function makeSampleResults(): Map<string, TaskResult> {
  const results = new Map<string, TaskResult>();
  results.set("code", {
    nodeId: "code",
    status: "completed",
    output: "Implemented feature X",
    toolsUsed: ["file_write"],
    turns: 3,
    startedAt: 1000,
    completedAt: 2000,
    tier: "standard",
  });
  results.set("test", {
    nodeId: "test",
    status: "completed",
    output: "All tests passing",
    toolsUsed: ["file_write", "bash"],
    turns: 2,
    startedAt: 2000,
    completedAt: 3000,
    tier: "standard",
  });
  return results;
}

function successSchedulerResult(): SchedulerResult {
  return {
    status: "completed",
    taskResults: new Map(),
    auditLog: { orchestrationId: "review", events: [] },
    durationMs: 100,
  };
}

function failedSchedulerResult(): SchedulerResult {
  return {
    status: "failed",
    taskResults: new Map(),
    auditLog: { orchestrationId: "review", events: [] },
    error: "Review found critical issues",
    durationMs: 150,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("buildReviewDAG", () => {
  it("creates a valid DAG with 2 nodes", () => {
    const reviewDAG = buildReviewDAG(SAMPLE_DAG, makeSampleResults());

    expect(reviewDAG.nodes).toHaveLength(2);
    expect(reviewDAG.id).toContain("review");
    expect(reviewDAG.name).toBeDefined();
    expect(reviewDAG.goal).toBeDefined();
  });

  it("includes reviewer and tester profiles", () => {
    const reviewDAG = buildReviewDAG(SAMPLE_DAG, makeSampleResults());

    const profiles = reviewDAG.nodes.map((n) => n.profile);
    expect(profiles).toContain("reviewer");
    expect(profiles).toContain("tester");
  });

  it("includes context from task results", () => {
    const reviewDAG = buildReviewDAG(SAMPLE_DAG, makeSampleResults());

    for (const node of reviewDAG.nodes) {
      expect(node.context).toContain("Review the following completed work:");
      expect(node.context).toContain("Write Code");
      expect(node.context).toContain("Implemented feature X");
      expect(node.context).toContain("Write Tests");
      expect(node.context).toContain("All tests passing");
    }
  });

  it("handles empty task results", () => {
    const reviewDAG = buildReviewDAG(SAMPLE_DAG, new Map());

    expect(reviewDAG.nodes).toHaveLength(2);
    for (const node of reviewDAG.nodes) {
      expect(node.context).toContain("Review the following completed work:");
    }
  });
});

describe("runReviewLoop", () => {
  beforeEach(() => {
    mockRunScheduler.mockReset();
  });

  it("returns passed=true when review succeeds", async () => {
    mockRunScheduler.mockResolvedValue(successSchedulerResult());

    const result = await runReviewLoop(SAMPLE_DAG, makeSampleResults(), {
      router: createFakeRouter(),
    });

    expect(result.passed).toBe(true);
    expect(result.reviewResult).toBeDefined();
    expect(result.reviewResult!.status).toBe("completed");
  });

  it("returns passed=false when review fails", async () => {
    mockRunScheduler.mockResolvedValue(failedSchedulerResult());

    const result = await runReviewLoop(SAMPLE_DAG, makeSampleResults(), {
      router: createFakeRouter(),
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("Review found critical issues");
    expect(result.reviewResult).toBeDefined();
    expect(result.reviewResult!.status).toBe("failed");
  });

  it("includes iteration count", async () => {
    mockRunScheduler.mockResolvedValue(successSchedulerResult());

    const result = await runReviewLoop(SAMPLE_DAG, makeSampleResults(), {
      router: createFakeRouter(),
    });

    expect(result.iterations).toBe(1);
  });

  it("passes callbacks through to scheduler", async () => {
    mockRunScheduler.mockResolvedValue(successSchedulerResult());

    const onTaskStarted = vi.fn();
    const callbacks = { onTaskStarted };

    await runReviewLoop(SAMPLE_DAG, makeSampleResults(), {
      router: createFakeRouter(),
      callbacks,
    });

    // Verify scheduler was called with the callbacks
    expect(mockRunScheduler).toHaveBeenCalledTimes(1);
    const callArgs = mockRunScheduler.mock.calls[0];
    expect(callArgs[3]).toBe(callbacks);
  });
});
