// ── Audit Logging ───────────────────────────────────────────────────

export type AuditEventType =
  | "orchestration_started"
  | "orchestration_completed"
  | "orchestration_failed"
  | "orchestration_cancelled"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_skipped"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "gate_resolved"
  | "phase_transition"
  | "state_transition";

export interface AuditEvent {
  timestamp: number;
  type: AuditEventType;
  message: string;
  taskId?: string;
  gateId?: string;
  data?: Record<string, unknown>;
}

export interface AuditLog {
  orchestrationId: string;
  events: AuditEvent[];
}

/** Create an empty audit log for the given orchestration. */
export function createAuditLog(orchestrationId: string): AuditLog {
  return { orchestrationId, events: [] };
}

/** Append an event with a Date.now() timestamp. Mutates the log. */
export function recordAuditEvent(
  log: AuditLog,
  event: Omit<AuditEvent, "timestamp">,
): void {
  log.events.push({ ...event, timestamp: Date.now() });
}

/** Return all events, optionally filtered by type. */
export function getAuditTrail(
  log: AuditLog,
  type?: AuditEventType,
): AuditEvent[] {
  if (type === undefined) return [...log.events];
  return log.events.filter((e) => e.type === type);
}

/** Return a human-readable formatted string of the audit trail. */
export function formatAuditTrail(log: AuditLog): string {
  return log.events
    .map((e) => {
      const iso = new Date(e.timestamp).toISOString();
      const taskPart = e.taskId ? ` [${e.taskId}]` : "";
      const gatePart = e.gateId ? ` [gate:${e.gateId}]` : "";
      return `${iso} ${e.type}${taskPart}${gatePart} — ${e.message}`;
    })
    .join("\n");
}
