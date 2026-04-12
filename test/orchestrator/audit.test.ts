import { describe, it, expect, vi } from "vitest";
import {
  createAuditLog,
  recordAuditEvent,
  getAuditTrail,
  formatAuditTrail,
} from "../../src/orchestrator/audit.js";
import type { AuditEvent, AuditEventType, AuditLog } from "../../src/orchestrator/audit.js";

describe("audit logging", () => {
  it("creates empty audit log", () => {
    const log = createAuditLog("orch-1");
    expect(log.orchestrationId).toBe("orch-1");
    expect(log.events).toEqual([]);
  });

  it("records events with timestamp", () => {
    const log = createAuditLog("orch-1");
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    recordAuditEvent(log, {
      type: "orchestration_started",
      message: "Orchestration started",
    });

    expect(log.events).toHaveLength(1);
    expect(log.events[0].timestamp).toBe(now);
    expect(log.events[0].type).toBe("orchestration_started");
    expect(log.events[0].message).toBe("Orchestration started");

    vi.restoreAllMocks();
  });

  it("records task events with taskId", () => {
    const log = createAuditLog("orch-1");
    recordAuditEvent(log, {
      type: "task_started",
      message: "Task started",
      taskId: "task-1",
    });

    expect(log.events).toHaveLength(1);
    expect(log.events[0].taskId).toBe("task-1");
    expect(log.events[0].type).toBe("task_started");
  });

  it("records approval events with gateId", () => {
    const log = createAuditLog("orch-1");
    recordAuditEvent(log, {
      type: "approval_requested",
      message: "Waiting for approval",
      gateId: "gate-1",
    });

    expect(log.events).toHaveLength(1);
    expect(log.events[0].gateId).toBe("gate-1");
    expect(log.events[0].type).toBe("approval_requested");
  });

  it("getAuditTrail filters by type", () => {
    const log = createAuditLog("orch-1");
    recordAuditEvent(log, {
      type: "orchestration_started",
      message: "Started",
    });
    recordAuditEvent(log, {
      type: "task_started",
      message: "Task 1 started",
      taskId: "task-1",
    });
    recordAuditEvent(log, {
      type: "task_completed",
      message: "Task 1 completed",
      taskId: "task-1",
    });
    recordAuditEvent(log, {
      type: "task_started",
      message: "Task 2 started",
      taskId: "task-2",
    });

    const all = getAuditTrail(log);
    expect(all).toHaveLength(4);

    const started = getAuditTrail(log, "task_started");
    expect(started).toHaveLength(2);
    expect(started.every((e) => e.type === "task_started")).toBe(true);

    const completed = getAuditTrail(log, "task_completed");
    expect(completed).toHaveLength(1);
  });

  it("formatAuditTrail produces readable output containing type, taskId, message", () => {
    const log = createAuditLog("orch-1");
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    recordAuditEvent(log, {
      type: "orchestration_started",
      message: "Orchestration started",
    });

    vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    recordAuditEvent(log, {
      type: "task_started",
      message: "Implement feature",
      taskId: "task-1",
    });

    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    recordAuditEvent(log, {
      type: "gate_resolved",
      message: "Gate passed",
      gateId: "gate-1",
    });

    vi.restoreAllMocks();

    const output = formatAuditTrail(log);

    // Should contain ISO timestamp
    expect(output).toContain(new Date(now).toISOString());
    // Should contain event types
    expect(output).toContain("orchestration_started");
    expect(output).toContain("task_started");
    expect(output).toContain("gate_resolved");
    // Should contain taskId and gateId
    expect(output).toContain("task-1");
    expect(output).toContain("gate:gate-1");
    // Should contain messages
    expect(output).toContain("Orchestration started");
    expect(output).toContain("Implement feature");
    expect(output).toContain("Gate passed");
  });
});
