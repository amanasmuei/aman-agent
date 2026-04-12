import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskDAG, TaskResult } from "../../src/orchestrator/types.js";
import type { ModelRouter } from "../../src/orchestrator/model-router.js";
import type { SchedulerCallbacks, SchedulerResult } from "../../src/orchestrator/scheduler.js";
import type { AuditLog } from "../../src/orchestrator/audit.js";

// ── Mocks ───────────────────────────────────────────────────────────

const mockSchedulerResult: SchedulerResult = {
  status: "completed",
  taskResults: new Map([
    [
      "t1",
      {
        nodeId: "t1",
        status: "completed",
        output: "done",
        toolsUsed: [],
        turns: 3,
        startedAt: 0,
        completedAt: 1,
        tier: "standard",
      },
    ],
  ]),
  auditLog: { orchestrationId: "test", events: [] },
  durationMs: 100,
};

const mockRunScheduler = vi.fn(
  async (
    _dag: TaskDAG,
    _router: ModelRouter,
    _opts?: unknown,
    callbacks?: SchedulerCallbacks,
  ): Promise<SchedulerResult> => {
    // Simulate task lifecycle callbacks so the runner's wrapped callbacks fire
    const dag = _dag as TaskDAG;
    for (const node of dag.nodes) {
      const result = mockSchedulerResult.taskResults.get(node.id);
      if (callbacks?.onTaskStarted) {
        await callbacks.onTaskStarted(node.id, node.name);
      }
      if (result && result.status === "completed" && callbacks?.onTaskCompleted) {
        await callbacks.onTaskCompleted(node.id, node.name, result);
      }
    }
    return { ...mockSchedulerResult };
  },
);

const mockRunReviewLoop = vi.fn(async () => ({
  passed: true,
  iterations: 1,
}));

vi.mock("../../src/orchestrator/scheduler.js", () => ({
  runScheduler: (...args: unknown[]) => mockRunScheduler(...args as Parameters<typeof mockRunScheduler>),
}));

vi.mock("../../src/orchestrator/review-loop.js", () => ({
  runReviewLoop: (...args: unknown[]) => mockRunReviewLoop(...args as Parameters<typeof mockRunReviewLoop>),
}));

vi.mock("../../src/delegate.js", () => ({ delegateTask: vi.fn() }));
vi.mock("../../src/delegate-remote.js", () => ({ delegateRemote: vi.fn() }));

import { runOrchestrationFull } from "../../src/orchestrator/runner.js";
import type { FullOrchestrationOptions } from "../../src/orchestrator/runner.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createFakeRouter(): ModelRouter {
  return { getClient: () => ({}) as any };
}

const SIMPLE_DAG: TaskDAG = {
  id: "test-dag",
  name: "Test DAG",
  goal: "Test runner",
  nodes: [
    { id: "t1", name: "Task 1", profile: "coder", tier: "standard", dependencies: [] },
  ],
  gates: [],
};

const TWO_TASK_DAG: TaskDAG = {
  id: "two-task",
  name: "Two Task DAG",
  goal: "Test two tasks",
  nodes: [
    { id: "t1", name: "Task 1", profile: "coder", tier: "standard", dependencies: [] },
    { id: "t2", name: "Task 2", profile: "tester", tier: "standard", dependencies: ["t1"] },
  ],
  gates: [],
};

// DAG with a dangling dependency — triggers policy error
const INVALID_DEP_DAG: TaskDAG = {
  id: "invalid-dep",
  name: "Invalid Dep DAG",
  goal: "Test policy block",
  nodes: [
    {
      id: "t1",
      name: "Task 1",
      profile: "coder",
      tier: "standard",
      dependencies: ["nonexistent"],
    },
  ],
  gates: [],
};

// DAG with only warnings (no errors)
const WARNING_DAG: TaskDAG = {
  id: "warning-dag",
  name: "Warning DAG",
  goal: "Test policy warnings pass through",
  nodes: [
    { id: "t1", name: "Task 1", profile: "coder", tier: "standard", dependencies: [] },
  ],
  gates: [],
};

function baseOptions(overrides?: Partial<FullOrchestrationOptions>): FullOrchestrationOptions {
  return {
    router: createFakeRouter(),
    enablePolicyCheck: false,
    enableCircuitBreaker: false,
    enableCostTracking: false,
    enableCheckpoints: false,
    enableSelfReview: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("runOrchestrationFull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the scheduler mock to default behavior
    mockRunScheduler.mockImplementation(
      async (_dag, _router, _opts, callbacks) => {
        const dag = _dag as TaskDAG;
        for (const node of dag.nodes) {
          const result = mockSchedulerResult.taskResults.get(node.id);
          if (callbacks?.onTaskStarted) {
            await callbacks.onTaskStarted(node.id, node.name);
          }
          if (result && result.status === "completed" && callbacks?.onTaskCompleted) {
            await callbacks.onTaskCompleted(node.id, node.name, result);
          }
        }
        return { ...mockSchedulerResult };
      },
    );
  });

  // 1. Runs scheduler and returns success
  it("runs scheduler and returns success", async () => {
    const result = await runOrchestrationFull(SIMPLE_DAG, baseOptions());

    expect(result.success).toBe(true);
    expect(result.scheduler.status).toBe("completed");
    expect(mockRunScheduler).toHaveBeenCalledOnce();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // 2. Policy check blocks execution when errors exist
  it("policy check blocks execution when errors exist", async () => {
    const result = await runOrchestrationFull(
      INVALID_DEP_DAG,
      baseOptions({ enablePolicyCheck: true }),
    );

    expect(result.success).toBe(false);
    expect(result.policy).toBeDefined();
    expect(result.policy!.passed).toBe(false);
    expect(result.policy!.violations.some((v) => v.severity === "error")).toBe(true);
    expect(result.scheduler.status).toBe("failed");
    expect(result.scheduler.error).toContain("Policy check failed");
    // Scheduler should NOT have been called
    expect(mockRunScheduler).not.toHaveBeenCalled();
  });

  // 3. Policy warnings don't block execution
  it("policy warnings do not block execution", async () => {
    const result = await runOrchestrationFull(
      WARNING_DAG,
      baseOptions({ enablePolicyCheck: true }),
    );

    expect(result.success).toBe(true);
    expect(result.policy).toBeDefined();
    expect(result.policy!.passed).toBe(true);
    // Has warnings (no reviewer, no tester)
    expect(result.policy!.violations.length).toBeGreaterThan(0);
    expect(result.policy!.violations.every((v) => v.severity !== "error")).toBe(true);
    expect(mockRunScheduler).toHaveBeenCalledOnce();
  });

  // 4. Circuit breaker records success on task completion
  it("circuit breaker records success on task completion", async () => {
    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ enableCircuitBreaker: true }),
    );

    expect(result.success).toBe(true);
    expect(result.circuitBreakerStatus).toBeDefined();
    expect(result.circuitBreakerStatus).toContain("coder");
    expect(result.circuitBreakerStatus).toContain("state=closed");
    expect(result.circuitBreakerStatus).toContain("failures=0");
  });

  // 5. Circuit breaker records failure on task failure
  it("circuit breaker records failure on task failure", async () => {
    const failedResult: SchedulerResult = {
      status: "failed",
      taskResults: new Map([
        [
          "t1",
          {
            nodeId: "t1",
            status: "failed",
            error: "boom",
            toolsUsed: [],
            turns: 1,
            startedAt: 0,
            completedAt: 1,
            tier: "standard",
          },
        ],
      ]),
      auditLog: { orchestrationId: "test", events: [] },
      error: "A task failed",
      durationMs: 50,
    };

    mockRunScheduler.mockImplementation(async (_dag, _router, _opts, callbacks) => {
      const dag = _dag as TaskDAG;
      for (const node of dag.nodes) {
        if (callbacks?.onTaskStarted) {
          await callbacks.onTaskStarted(node.id, node.name);
        }
        if (callbacks?.onTaskFailed) {
          await callbacks.onTaskFailed(node.id, node.name, "boom");
        }
      }
      return failedResult;
    });

    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ enableCircuitBreaker: true }),
    );

    expect(result.success).toBe(false);
    expect(result.circuitBreakerStatus).toBeDefined();
    expect(result.circuitBreakerStatus).toContain("failures=1");
  });

  // 6. Cost tracker records usage per task
  it("cost tracker records usage per task", async () => {
    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ enableCostTracking: true }),
    );

    expect(result.success).toBe(true);
    expect(result.costSummary).toBeDefined();
    expect(result.costSummary).toContain("Total:");
    expect(result.costSummary).toContain("Entries: 1");
  });

  // 7. Cost tracker detects over-budget (success=false)
  it("cost tracker detects over-budget", async () => {
    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({
        enableCostTracking: true,
        budgetLimit: 0.0000001, // Absurdly low budget
      }),
    );

    expect(result.success).toBe(false);
    expect(result.costSummary).toBeDefined();
    expect(result.costSummary).toContain("Budget:");
  });

  // 8. Self-review runs when enabled and scheduler completed
  it("self-review runs when enabled and scheduler completed", async () => {
    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ enableSelfReview: true }),
    );

    expect(result.success).toBe(true);
    expect(result.review).toBeDefined();
    expect(result.review!.passed).toBe(true);
    expect(mockRunReviewLoop).toHaveBeenCalledOnce();
  });

  // 9. Self-review skipped when scheduler failed
  it("self-review skipped when scheduler failed", async () => {
    mockRunScheduler.mockResolvedValue({
      status: "failed",
      taskResults: new Map(),
      auditLog: { orchestrationId: "test", events: [] },
      error: "Something broke",
      durationMs: 10,
    });

    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ enableSelfReview: true }),
    );

    expect(result.success).toBe(false);
    expect(result.review).toBeUndefined();
    expect(mockRunReviewLoop).not.toHaveBeenCalled();
  });

  // 10. All features disabled gracefully (bare minimum run)
  it("all features disabled gracefully", async () => {
    const result = await runOrchestrationFull(SIMPLE_DAG, baseOptions());

    expect(result.success).toBe(true);
    expect(result.policy).toBeUndefined();
    expect(result.review).toBeUndefined();
    expect(result.costSummary).toBeUndefined();
    expect(result.circuitBreakerStatus).toBeUndefined();
    expect(result.checkpointPath).toBeUndefined();
    expect(result.scheduler.status).toBe("completed");
  });

  // 11. Callbacks are passed through to scheduler
  it("callbacks are passed through to scheduler", async () => {
    const onTaskStarted = vi.fn();
    const onTaskCompleted = vi.fn();

    await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({
        callbacks: {
          onTaskStarted,
          onTaskCompleted,
        },
      }),
    );

    // The wrapped callbacks should invoke the user's original callbacks
    expect(onTaskStarted).toHaveBeenCalledWith("t1", "Task 1");
    expect(onTaskCompleted).toHaveBeenCalledWith("t1", "Task 1", expect.any(Object));
  });

  // 12. durationMs is calculated correctly
  it("durationMs is calculated correctly", async () => {
    // Make scheduler take a bit of time
    mockRunScheduler.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ...mockSchedulerResult };
    });

    const result = await runOrchestrationFull(SIMPLE_DAG, baseOptions());

    expect(result.durationMs).toBeGreaterThanOrEqual(15);
    expect(result.durationMs).toBeLessThan(5000);
  });

  // 13. Self-review failure causes success=false
  it("self-review failure causes success=false", async () => {
    mockRunReviewLoop.mockResolvedValue({
      passed: false,
      iterations: 1,
      reason: "Code quality issues",
    });

    const result = await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ enableSelfReview: true }),
    );

    expect(result.success).toBe(false);
    expect(result.review).toBeDefined();
    expect(result.review!.passed).toBe(false);
  });

  // 14. maxParallelTasks is forwarded to scheduler
  it("forwards maxParallelTasks to scheduler", async () => {
    await runOrchestrationFull(
      SIMPLE_DAG,
      baseOptions({ maxParallelTasks: 8 }),
    );

    expect(mockRunScheduler).toHaveBeenCalledWith(
      SIMPLE_DAG,
      expect.any(Object),
      expect.objectContaining({ maxParallelTasks: 8 }),
      expect.any(Object),
    );
  });
});
