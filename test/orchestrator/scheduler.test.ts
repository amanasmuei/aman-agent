import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskDAG } from "../../src/orchestrator/types.js";
import type { ModelRouter } from "../../src/orchestrator/model-router.js";
import type { DelegationResult } from "../../src/delegate.js";

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

import { delegateTask } from "../../src/delegate.js";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import type { SchedulerCallbacks } from "../../src/orchestrator/scheduler.js";

const mockDelegate = vi.mocked(delegateTask);

// ── Fake ModelRouter ────────────────────────────────────────────────

function createFakeRouter(): ModelRouter {
  return {
    getClient: () => ({} as any),
  };
}

// ── Test DAGs ───────────────────────────────────────────────────────

const LINEAR_DAG: TaskDAG = {
  id: "linear",
  name: "Linear DAG",
  goal: "Test linear execution",
  nodes: [
    { id: "a", name: "Task A", profile: "coder", tier: "standard", dependencies: [] },
    { id: "b", name: "Task B", profile: "coder", tier: "standard", dependencies: ["a"] },
  ],
  gates: [],
};

const PARALLEL_DAG: TaskDAG = {
  id: "parallel",
  name: "Parallel DAG",
  goal: "Test parallel branches",
  nodes: [
    { id: "a", name: "Task A", profile: "coder", tier: "standard", dependencies: [] },
    { id: "b", name: "Task B", profile: "coder", tier: "standard", dependencies: ["a"] },
    { id: "c", name: "Task C", profile: "coder", tier: "standard", dependencies: ["a"] },
    { id: "d", name: "Task D", profile: "coder", tier: "standard", dependencies: ["b", "c"] },
  ],
  gates: [],
};

const GATED_DAG: TaskDAG = {
  id: "gated",
  name: "Gated DAG",
  goal: "Test approval gate",
  nodes: [
    { id: "code", name: "Write Code", profile: "coder", tier: "standard", dependencies: [] },
    { id: "deploy", name: "Deploy", profile: "deployer", tier: "standard", dependencies: ["code"] },
  ],
  gates: [
    {
      id: "approval",
      name: "Deploy Approval",
      type: "approval",
      afterNodes: ["code"],
      beforeNodes: ["deploy"],
    },
  ],
};

// ── Tests ───────────────────────────────────────────────────────────

describe("DAG Scheduler", () => {
  beforeEach(() => {
    mockDelegate.mockClear();
    mockDelegate.mockImplementation(async (task: string, profile: string) => ({
      profile,
      task,
      response: `Done: ${task}`,
      toolsUsed: [],
      turns: 1,
      success: true,
    }));
  });

  it("executes linear DAG (A->B) in order, both complete, status completed", async () => {
    const executionOrder: string[] = [];
    mockDelegate.mockImplementation(async (task: string, profile: string) => {
      executionOrder.push(task);
      return { profile, task, response: `Done: ${task}`, toolsUsed: [], turns: 1, success: true };
    });

    const result = await runScheduler(LINEAR_DAG, createFakeRouter());

    expect(result.status).toBe("completed");
    expect(result.taskResults.size).toBe(2);
    expect(result.taskResults.get("a")?.status).toBe("completed");
    expect(result.taskResults.get("b")?.status).toBe("completed");
    // A must start before B
    const aIdx = executionOrder.findIndex((t) => t.includes("Task A"));
    const bIdx = executionOrder.findIndex((t) => t.includes("Task B"));
    expect(aIdx).toBeLessThan(bIdx);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("executes parallel branches concurrently (A->(B,C)->D), A first and D last", async () => {
    const executionOrder: string[] = [];
    mockDelegate.mockImplementation(async (task: string, profile: string) => {
      executionOrder.push(task);
      return { profile, task, response: `Done: ${task}`, toolsUsed: [], turns: 1, success: true };
    });

    const result = await runScheduler(PARALLEL_DAG, createFakeRouter());

    expect(result.status).toBe("completed");
    expect(result.taskResults.size).toBe(4);

    // A must be first
    expect(executionOrder[0]).toContain("Task A");
    // D must be last
    expect(executionOrder[executionOrder.length - 1]).toContain("Task D");
  });

  it("pauses at approval gate, calls onApprovalRequired, resumes when approved", async () => {
    const approvalCalled = vi.fn(async () => true);
    const callbacks: SchedulerCallbacks = {
      onApprovalRequired: approvalCalled,
    };

    const result = await runScheduler(GATED_DAG, createFakeRouter(), {}, callbacks);

    expect(result.status).toBe("completed");
    expect(approvalCalled).toHaveBeenCalledWith("approval", "Deploy Approval");
    expect(result.taskResults.size).toBe(2);
    expect(result.taskResults.get("deploy")?.status).toBe("completed");
  });

  it("stops orchestration when approval denied (status cancelled)", async () => {
    const callbacks: SchedulerCallbacks = {
      onApprovalRequired: async () => false,
    };

    const result = await runScheduler(GATED_DAG, createFakeRouter(), {}, callbacks);

    expect(result.status).toBe("cancelled");
    // code should have completed, deploy should not
    expect(result.taskResults.get("code")?.status).toBe("completed");
    expect(result.taskResults.has("deploy")).toBe(false);
  });

  it("marks orchestration failed when a task fails", async () => {
    mockDelegate.mockImplementation(async (task: string, profile: string) => {
      if (task.includes("Task A")) {
        return { profile, task, response: "", toolsUsed: [], turns: 1, success: false, error: "boom" };
      }
      return { profile, task, response: `Done: ${task}`, toolsUsed: [], turns: 1, success: true };
    });

    const result = await runScheduler(LINEAR_DAG, createFakeRouter());

    expect(result.status).toBe("failed");
    expect(result.taskResults.get("a")?.status).toBe("failed");
    expect(result.error).toBeDefined();
  });

  it("respects maxParallelTasks limit (5 parallel tasks with limit 2)", async () => {
    const fiveParallel: TaskDAG = {
      id: "five",
      name: "Five Parallel",
      goal: "Test concurrency limit",
      nodes: [
        { id: "t1", name: "T1", profile: "coder", tier: "standard", dependencies: [] },
        { id: "t2", name: "T2", profile: "coder", tier: "standard", dependencies: [] },
        { id: "t3", name: "T3", profile: "coder", tier: "standard", dependencies: [] },
        { id: "t4", name: "T4", profile: "coder", tier: "standard", dependencies: [] },
        { id: "t5", name: "T5", profile: "coder", tier: "standard", dependencies: [] },
      ],
      gates: [],
    };

    let currentConcurrent = 0;
    let maxConcurrent = 0;

    mockDelegate.mockImplementation(async (task: string, profile: string) => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
      await new Promise((r) => setTimeout(r, 50));
      currentConcurrent--;
      return { profile, task, response: "Done", toolsUsed: [], turns: 1, success: true };
    });

    const result = await runScheduler(fiveParallel, createFakeRouter(), { maxParallelTasks: 2 });

    expect(result.status).toBe("completed");
    expect(result.taskResults.size).toBe(5);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("calls onTaskStarted and onTaskCompleted callbacks", async () => {
    const started: string[] = [];
    const completed: string[] = [];

    const callbacks: SchedulerCallbacks = {
      onTaskStarted: async (nodeId, nodeName) => { started.push(nodeId); },
      onTaskCompleted: async (nodeId, nodeName, result) => { completed.push(nodeId); },
    };

    await runScheduler(LINEAR_DAG, createFakeRouter(), {}, callbacks);

    expect(started).toContain("a");
    expect(started).toContain("b");
    expect(completed).toContain("a");
    expect(completed).toContain("b");
  });

  it("populates auditLog with events", async () => {
    const result = await runScheduler(LINEAR_DAG, createFakeRouter());

    expect(result.auditLog.events.length).toBeGreaterThan(0);
    const types = result.auditLog.events.map((e) => e.type);
    expect(types).toContain("orchestration_started");
    expect(types).toContain("task_started");
    expect(types).toContain("task_completed");
    expect(types).toContain("orchestration_completed");
  });
});
