import { describe, it, expect } from "vitest";
import type { TaskDAG, OrchestrationState } from "../../src/orchestrator/types.js";
import {
  InvalidTransitionError,
  createOrchestrationState,
  canTransition,
  getValidTransitions,
  transition,
  transitionTask,
} from "../../src/orchestrator/state-machine.js";

const makeDag = (nodeCount = 2): TaskDAG => ({
  id: "dag-1",
  name: "Test DAG",
  goal: "Test orchestration",
  nodes: Array.from({ length: nodeCount }, (_, i) => ({
    id: `task-${i + 1}`,
    name: `Task ${i + 1}`,
    profile: "developer",
    tier: "standard" as const,
    dependencies: [],
  })),
  gates: [],
});

describe("state-machine", () => {
  // ── createOrchestrationState ────────────────────────────────────────
  describe("createOrchestrationState", () => {
    it("initializes with pending status", () => {
      const state = createOrchestrationState(makeDag());
      expect(state.status).toBe("pending");
    });

    it("sets all tasks to pending", () => {
      const dag = makeDag(3);
      const state = createOrchestrationState(dag);
      expect(state.taskStatuses.size).toBe(3);
      for (const status of state.taskStatuses.values()) {
        expect(status).toBe("pending");
      }
    });

    it("starts with empty taskResults", () => {
      const state = createOrchestrationState(makeDag());
      expect(state.taskResults.size).toBe(0);
    });

    it("stores the dag reference", () => {
      const dag = makeDag();
      const state = createOrchestrationState(dag);
      expect(state.dag).toBe(dag);
    });

    it("sets startedAt and updatedAt timestamps", () => {
      const before = Date.now();
      const state = createOrchestrationState(makeDag());
      const after = Date.now();
      expect(state.startedAt).toBeGreaterThanOrEqual(before);
      expect(state.startedAt).toBeLessThanOrEqual(after);
      expect(state.updatedAt).toBe(state.startedAt);
    });

    it("has no completedAt or error", () => {
      const state = createOrchestrationState(makeDag());
      expect(state.completedAt).toBeUndefined();
      expect(state.error).toBeUndefined();
    });

    it("has no active gate", () => {
      const state = createOrchestrationState(makeDag());
      expect(state.activeGate).toBeNull();
    });
  });

  // ── canTransition ──────────────────────────────────────────────────
  describe("canTransition", () => {
    it("pending → running is valid", () => {
      const state = createOrchestrationState(makeDag());
      expect(canTransition(state, "running")).toBe(true);
    });

    it("pending → cancelled is valid", () => {
      const state = createOrchestrationState(makeDag());
      expect(canTransition(state, "cancelled")).toBe(true);
    });

    it("pending → completed is invalid", () => {
      const state = createOrchestrationState(makeDag());
      expect(canTransition(state, "completed")).toBe(false);
    });

    it("running → awaiting_approval is valid", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      expect(canTransition(state, "awaiting_approval")).toBe(true);
    });

    it("completed is terminal — no transitions", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      state = transition(state, "completed");
      expect(canTransition(state, "running")).toBe(false);
      expect(canTransition(state, "pending")).toBe(false);
    });

    it("failed is terminal", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      state = transition(state, "failed");
      expect(canTransition(state, "running")).toBe(false);
    });

    it("cancelled is terminal", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "cancelled");
      expect(canTransition(state, "running")).toBe(false);
    });
  });

  // ── getValidTransitions ────────────────────────────────────────────
  describe("getValidTransitions", () => {
    it("pending has running and cancelled", () => {
      const state = createOrchestrationState(makeDag());
      const valid = getValidTransitions(state);
      expect(valid).toEqual(expect.arrayContaining(["running", "cancelled"]));
      expect(valid).toHaveLength(2);
    });

    it("running has 5 options", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      const valid = getValidTransitions(state);
      expect(valid).toEqual(
        expect.arrayContaining([
          "awaiting_approval",
          "paused",
          "completed",
          "failed",
          "cancelled",
        ]),
      );
      expect(valid).toHaveLength(5);
    });

    it("terminal states have empty array", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");

      const completed = transition(state, "completed");
      expect(getValidTransitions(completed)).toEqual([]);

      const failed = transition(state, "failed");
      expect(getValidTransitions(failed)).toEqual([]);

      const cancelled = transition(state, "cancelled");
      expect(getValidTransitions(cancelled)).toEqual([]);
    });

    it("awaiting_approval has approved, cancelled, failed", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      state = transition(state, "awaiting_approval");
      const valid = getValidTransitions(state);
      expect(valid).toEqual(
        expect.arrayContaining(["approved", "cancelled", "failed"]),
      );
      expect(valid).toHaveLength(3);
    });

    it("approved has running and cancelled", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      state = transition(state, "awaiting_approval");
      state = transition(state, "approved");
      const valid = getValidTransitions(state);
      expect(valid).toEqual(expect.arrayContaining(["running", "cancelled"]));
      expect(valid).toHaveLength(2);
    });

    it("paused has running, cancelled, failed", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      state = transition(state, "paused");
      const valid = getValidTransitions(state);
      expect(valid).toEqual(
        expect.arrayContaining(["running", "cancelled", "failed"]),
      );
      expect(valid).toHaveLength(3);
    });
  });

  // ── transition ─────────────────────────────────────────────────────
  describe("transition", () => {
    it("returns a new state object", () => {
      const state = createOrchestrationState(makeDag());
      const next = transition(state, "running");
      expect(next).not.toBe(state);
    });

    it("updates updatedAt timestamp", () => {
      const state = createOrchestrationState(makeDag());
      const next = transition(state, "running");
      expect(next.updatedAt).toBeGreaterThanOrEqual(state.updatedAt);
    });

    it("sets completedAt on terminal states", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");

      const completed = transition(state, "completed");
      expect(completed.completedAt).toBeDefined();
      expect(typeof completed.completedAt).toBe("number");

      const failed = transition(state, "failed");
      expect(failed.completedAt).toBeDefined();

      const cancelled = transition(state, "cancelled");
      expect(cancelled.completedAt).toBeDefined();
    });

    it("does not set completedAt on non-terminal states", () => {
      const state = createOrchestrationState(makeDag());
      const running = transition(state, "running");
      expect(running.completedAt).toBeUndefined();
    });

    it("stores error message on failed", () => {
      let state = createOrchestrationState(makeDag());
      state = transition(state, "running");
      const failed = transition(state, "failed", "something broke");
      expect(failed.error).toBe("something broke");
    });

    it("throws InvalidTransitionError on invalid transition", () => {
      const state = createOrchestrationState(makeDag());
      expect(() => transition(state, "completed")).toThrow(
        InvalidTransitionError,
      );
    });

    it("InvalidTransitionError has from, to, entity", () => {
      const state = createOrchestrationState(makeDag());
      try {
        transition(state, "completed");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidTransitionError);
        const err = e as InvalidTransitionError;
        expect(err.message).toContain("pending");
        expect(err.message).toContain("completed");
      }
    });

    it("original state is unchanged (immutable)", () => {
      const state = createOrchestrationState(makeDag());
      const originalStatus = state.status;
      const originalUpdatedAt = state.updatedAt;
      transition(state, "running");
      expect(state.status).toBe(originalStatus);
      expect(state.updatedAt).toBe(originalUpdatedAt);
    });

    it("deep-copies taskStatuses map", () => {
      const state = createOrchestrationState(makeDag());
      const next = transition(state, "running");
      // Mutating the new map should not affect the original
      next.taskStatuses.set("task-1", "running");
      expect(state.taskStatuses.get("task-1")).toBe("pending");
    });

    it("deep-copies taskResults map", () => {
      const state = createOrchestrationState(makeDag());
      const next = transition(state, "running");
      next.taskResults.set("task-1", {
        nodeId: "task-1",
        status: "running",
        toolsUsed: [],
        turns: 0,
        startedAt: Date.now(),
        tier: "standard",
      });
      expect(state.taskResults.size).toBe(0);
    });
  });

  // ── transitionTask ─────────────────────────────────────────────────
  describe("transitionTask", () => {
    it("updates a single task status", () => {
      const state = createOrchestrationState(makeDag());
      const next = transitionTask(state, "task-1", "ready");
      expect(next.taskStatuses.get("task-1")).toBe("ready");
      // Other tasks unchanged
      expect(next.taskStatuses.get("task-2")).toBe("pending");
    });

    it("returns a new state (immutable)", () => {
      const state = createOrchestrationState(makeDag());
      const next = transitionTask(state, "task-1", "ready");
      expect(next).not.toBe(state);
      expect(state.taskStatuses.get("task-1")).toBe("pending");
    });

    it("throws for unknown task id", () => {
      const state = createOrchestrationState(makeDag());
      expect(() => transitionTask(state, "nonexistent", "ready")).toThrow();
    });

    it("valid lifecycle: pending → ready → running → completed", () => {
      let state = createOrchestrationState(makeDag());
      state = transitionTask(state, "task-1", "ready");
      expect(state.taskStatuses.get("task-1")).toBe("ready");
      state = transitionTask(state, "task-1", "running");
      expect(state.taskStatuses.get("task-1")).toBe("running");
      state = transitionTask(state, "task-1", "completed");
      expect(state.taskStatuses.get("task-1")).toBe("completed");
    });

    it("invalid: completed → running throws", () => {
      let state = createOrchestrationState(makeDag());
      state = transitionTask(state, "task-1", "ready");
      state = transitionTask(state, "task-1", "running");
      state = transitionTask(state, "task-1", "completed");
      expect(() => transitionTask(state, "task-1", "running")).toThrow(
        InvalidTransitionError,
      );
    });

    it("failed → ready (retry) is valid", () => {
      let state = createOrchestrationState(makeDag());
      state = transitionTask(state, "task-1", "ready");
      state = transitionTask(state, "task-1", "running");
      state = transitionTask(state, "task-1", "failed");
      state = transitionTask(state, "task-1", "ready");
      expect(state.taskStatuses.get("task-1")).toBe("ready");
    });

    it("skipped is terminal", () => {
      let state = createOrchestrationState(makeDag());
      state = transitionTask(state, "task-1", "skipped");
      expect(() => transitionTask(state, "task-1", "ready")).toThrow(
        InvalidTransitionError,
      );
    });

    it("blocked → ready is valid", () => {
      let state = createOrchestrationState(makeDag());
      state = transitionTask(state, "task-1", "blocked");
      state = transitionTask(state, "task-1", "ready");
      expect(state.taskStatuses.get("task-1")).toBe("ready");
    });

    it("blocked → skipped is valid", () => {
      let state = createOrchestrationState(makeDag());
      state = transitionTask(state, "task-1", "blocked");
      state = transitionTask(state, "task-1", "skipped");
      expect(state.taskStatuses.get("task-1")).toBe("skipped");
    });

    it("updates updatedAt", () => {
      const state = createOrchestrationState(makeDag());
      const next = transitionTask(state, "task-1", "ready");
      expect(next.updatedAt).toBeGreaterThanOrEqual(state.updatedAt);
    });
  });
});
