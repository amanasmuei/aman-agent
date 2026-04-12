import { describe, it, expect } from "vitest";
import {
  createMetrics,
  recordTaskCompletion,
  recordPhaseStart,
  recordPhaseCompletion,
  recordApprovalGate,
  finalizeMetrics,
  formatMetrics,
  type OrchestrationMetrics,
  type PhaseMetrics,
  type AgentMetrics,
} from "../../src/project/monitoring.js";

describe("monitoring", () => {
  describe("createMetrics", () => {
    it("initializes with zeros and empty collections", () => {
      const m = createMetrics("orch-1");
      expect(m.orchestrationId).toBe("orch-1");
      expect(m.startedAt).toBeGreaterThan(0);
      expect(m.completedAt).toBeUndefined();
      expect(m.durationMs).toBeUndefined();
      expect(m.status).toBe("running");
      expect(m.phases).toEqual([]);
      expect(m.agents).toBeInstanceOf(Map);
      expect(m.agents.size).toBe(0);
      expect(m.totalTasks).toBe(0);
      expect(m.completedTasks).toBe(0);
      expect(m.failedTasks).toBe(0);
      expect(m.approvalGates).toBe(0);
      expect(m.approvedGates).toBe(0);
    });
  });

  describe("recordTaskCompletion", () => {
    it("increments agent stats on success", () => {
      const m = createMetrics("orch-2");
      recordTaskCompletion(m, "coder", 5, ["read", "write"], true);
      expect(m.totalTasks).toBe(1);
      expect(m.completedTasks).toBe(1);
      expect(m.failedTasks).toBe(0);
      const agent = m.agents.get("coder")!;
      expect(agent.profile).toBe("coder");
      expect(agent.tasksCompleted).toBe(1);
      expect(agent.tasksFailed).toBe(0);
      expect(agent.totalTurns).toBe(5);
    });

    it("increments agent stats on failure", () => {
      const m = createMetrics("orch-f");
      recordTaskCompletion(m, "coder", 3, ["read"], false);
      expect(m.totalTasks).toBe(1);
      expect(m.completedTasks).toBe(0);
      expect(m.failedTasks).toBe(1);
      const agent = m.agents.get("coder")!;
      expect(agent.tasksCompleted).toBe(0);
      expect(agent.tasksFailed).toBe(1);
    });

    it("accumulates tools used without duplicates", () => {
      const m = createMetrics("orch-3");
      recordTaskCompletion(m, "coder", 2, ["read", "write"], true);
      recordTaskCompletion(m, "coder", 3, ["write", "exec"], true);
      const agent = m.agents.get("coder")!;
      expect(agent.toolsUsed).toEqual(
        expect.arrayContaining(["read", "write", "exec"]),
      );
      expect(agent.toolsUsed.length).toBe(3);
    });

    it("calculates avgTurnsPerTask", () => {
      const m = createMetrics("orch-4");
      recordTaskCompletion(m, "coder", 4, [], true);
      recordTaskCompletion(m, "coder", 6, [], true);
      const agent = m.agents.get("coder")!;
      expect(agent.avgTurnsPerTask).toBe(5);
    });
  });

  describe("recordPhaseStart", () => {
    it("adds a new phase with startedAt", () => {
      const m = createMetrics("orch-5");
      recordPhaseStart(m, "planning", 3);
      expect(m.phases.length).toBe(1);
      expect(m.phases[0].name).toBe("planning");
      expect(m.phases[0].taskCount).toBe(3);
      expect(m.phases[0].startedAt).toBeGreaterThan(0);
      expect(m.phases[0].completedAt).toBeUndefined();
    });
  });

  describe("recordPhaseCompletion", () => {
    it("updates phase with completion data", () => {
      const m = createMetrics("orch-6");
      recordPhaseStart(m, "coding", 5);
      recordPhaseCompletion(m, "coding", 4, 1);
      const phase = m.phases[0];
      expect(phase.completedAt).toBeGreaterThan(0);
      expect(phase.durationMs).toBeDefined();
      expect(phase.durationMs).toBeGreaterThanOrEqual(0);
      expect(phase.completedTasks).toBe(4);
      expect(phase.failedTasks).toBe(1);
    });
  });

  describe("recordApprovalGate", () => {
    it("tracks approved gates", () => {
      const m = createMetrics("orch-7");
      recordApprovalGate(m, true);
      expect(m.approvalGates).toBe(1);
      expect(m.approvedGates).toBe(1);
    });

    it("tracks rejected gates", () => {
      const m = createMetrics("orch-8");
      recordApprovalGate(m, false);
      expect(m.approvalGates).toBe(1);
      expect(m.approvedGates).toBe(0);
    });

    it("tracks mixed approved and rejected", () => {
      const m = createMetrics("orch-9");
      recordApprovalGate(m, true);
      recordApprovalGate(m, false);
      recordApprovalGate(m, true);
      expect(m.approvalGates).toBe(3);
      expect(m.approvedGates).toBe(2);
    });
  });

  describe("finalizeMetrics", () => {
    it("sets completedAt, durationMs, and status", () => {
      const m = createMetrics("orch-10");
      finalizeMetrics(m, "completed");
      expect(m.completedAt).toBeGreaterThan(0);
      expect(m.durationMs).toBeDefined();
      expect(m.durationMs).toBeGreaterThanOrEqual(0);
      expect(m.status).toBe("completed");
    });
  });

  describe("formatMetrics", () => {
    it("produces readable output", () => {
      const m = createMetrics("orch-fmt");
      recordPhaseStart(m, "plan", 2);
      recordTaskCompletion(m, "architect", 3, ["read"], true);
      recordTaskCompletion(m, "coder", 5, ["read", "write"], true);
      recordTaskCompletion(m, "coder", 7, ["write", "exec"], false);
      recordPhaseCompletion(m, "plan", 2, 1);
      recordApprovalGate(m, true);
      finalizeMetrics(m, "completed");

      const output = formatMetrics(m);
      expect(output).toContain("Orchestration: orch-fmt");
      expect(output).toContain("Status: completed");
      expect(output).toContain("Duration:");
      expect(output).toContain("Tasks: 2/3 completed, 1 failed");
      expect(output).toContain("architect");
      expect(output).toContain("coder");
      expect(output).toContain("Approval Gates: 1/1 approved");
    });
  });

  describe("multiple agents tracked independently", () => {
    it("tracks each agent profile separately", () => {
      const m = createMetrics("orch-multi");
      recordTaskCompletion(m, "architect", 3, ["read"], true);
      recordTaskCompletion(m, "coder", 5, ["write"], true);
      recordTaskCompletion(m, "coder", 7, ["exec"], true);
      recordTaskCompletion(m, "reviewer", 2, ["read"], false);

      expect(m.agents.size).toBe(3);

      const arch = m.agents.get("architect")!;
      expect(arch.tasksCompleted).toBe(1);
      expect(arch.avgTurnsPerTask).toBe(3);

      const coder = m.agents.get("coder")!;
      expect(coder.tasksCompleted).toBe(2);
      expect(coder.avgTurnsPerTask).toBe(6);

      const rev = m.agents.get("reviewer")!;
      expect(rev.tasksCompleted).toBe(0);
      expect(rev.tasksFailed).toBe(1);
      expect(rev.avgTurnsPerTask).toBe(2);

      expect(m.totalTasks).toBe(4);
      expect(m.completedTasks).toBe(3);
      expect(m.failedTasks).toBe(1);
    });
  });
});
