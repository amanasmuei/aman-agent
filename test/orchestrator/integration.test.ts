import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskDAG } from "../../src/orchestrator/types.js";

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../../src/delegate.js", () => ({
  delegateTask: vi.fn(async (task: string, profile: string) => ({
    profile,
    task,
    response: `Done: ${task}`,
    toolsUsed: [],
    turns: 1,
    success: true,
  })),
}));

vi.mock("../../src/delegate-remote.js", () => ({
  delegateRemote: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function makeSimpleDAG(): TaskDAG {
  return {
    id: "dag-1",
    name: "Simple DAG",
    goal: "Test basic orchestration",
    nodes: [
      {
        id: "a",
        name: "Task A",
        profile: "coder",
        tier: "standard",
        dependencies: [],
      },
      {
        id: "b",
        name: "Task B",
        profile: "tester",
        tier: "fast",
        dependencies: ["a"],
      },
    ],
    gates: [],
  };
}

function makeCyclicDAG(): TaskDAG {
  return {
    id: "dag-cyc",
    name: "Cyclic DAG",
    goal: "Should be rejected",
    nodes: [
      {
        id: "x",
        name: "Task X",
        profile: "coder",
        tier: "standard",
        dependencies: ["y"],
      },
      {
        id: "y",
        name: "Task Y",
        profile: "coder",
        tier: "standard",
        dependencies: ["x"],
      },
    ],
    gates: [],
  };
}

const fakeRouter = {
  getClient: () => ({
    chat: vi.fn(),
    model: "fake",
  }),
};

// ── Tests ───────────────────────────────────────────────────────────

describe("Public API — createOrchestration", () => {
  it("validates DAG and returns state with status 'pending'", async () => {
    const { createOrchestration } = await import(
      "../../src/orchestrator/index.js"
    );
    const dag = makeSimpleDAG();
    const state = createOrchestration(dag);

    expect(state.status).toBe("pending");
    expect(state.dag).toBe(dag);
    expect(state.taskStatuses.get("a")).toBe("pending");
    expect(state.taskStatuses.get("b")).toBe("pending");
  });

  it("rejects invalid (cyclic) DAG with DAGValidationError", async () => {
    const { createOrchestration } = await import(
      "../../src/orchestrator/index.js"
    );
    const { DAGValidationError } = await import(
      "../../src/orchestrator/dag.js"
    );
    const dag = makeCyclicDAG();

    expect(() => createOrchestration(dag)).toThrow(DAGValidationError);
  });
});

describe("Public API — runOrchestration", () => {
  it("executes DAG end-to-end and returns completed status with results and audit log", async () => {
    const { runOrchestration } = await import(
      "../../src/orchestrator/index.js"
    );
    const dag = makeSimpleDAG();

    const result = await runOrchestration(dag, fakeRouter);

    expect(result.status).toBe("completed");
    expect(result.taskResults.size).toBe(2);
    expect(result.taskResults.get("a")!.status).toBe("completed");
    expect(result.taskResults.get("b")!.status).toBe("completed");
    expect(result.auditLog.events.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
