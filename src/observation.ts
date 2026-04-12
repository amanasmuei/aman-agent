import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ── Types ──

export type ObservationEventType =
  | "tool_call"
  | "tool_error"
  | "topic_shift"
  | "decision"
  | "blocker"
  | "milestone"
  | "file_change"
  | "sentiment_shift"
  | "error"
  | "phase_start"
  | "phase_complete"
  | "approval_gate"
  | "task_delegated";

export interface ObservationEvent {
  timestamp: number;
  type: ObservationEventType;
  summary: string;
  data: Record<string, unknown>;
}

export interface ObservationSession {
  sessionId: string;
  startedAt: number;
  events: ObservationEvent[];
  paused: boolean;
  stats: {
    toolCalls: number;
    toolErrors: number;
    topicShifts: number;
    blockers: number;
    milestones: number;
    fileChanges: number;
  };
}

// ── Stat counters by event type ──

const STAT_MAP: Partial<Record<ObservationEventType, keyof ObservationSession["stats"]>> = {
  tool_call: "toolCalls",
  tool_error: "toolErrors",
  topic_shift: "topicShifts",
  blocker: "blockers",
  milestone: "milestones",
  file_change: "fileChanges",
};

// ── Default observations directory ──

export function defaultObservationsDir(): string {
  return path.join(os.homedir(), ".acore", "observations");
}

// ── Core functions ──

export function createObservationSession(sessionId: string): ObservationSession {
  return {
    sessionId,
    startedAt: Date.now(),
    events: [],
    paused: false,
    stats: {
      toolCalls: 0,
      toolErrors: 0,
      topicShifts: 0,
      blockers: 0,
      milestones: 0,
      fileChanges: 0,
    },
  };
}

export function recordEvent(
  session: ObservationSession,
  event: Omit<ObservationEvent, "timestamp">,
): void {
  if (session.paused) return;

  const full: ObservationEvent = { ...event, timestamp: Date.now() };
  session.events.push(full);

  const statKey = STAT_MAP[event.type];
  if (statKey) {
    session.stats[statKey]++;
  }
}

export function pauseObservation(session: ObservationSession): void {
  session.paused = true;
}

export function resumeObservation(session: ObservationSession): void {
  session.paused = false;
}

export async function flushEvents(
  session: ObservationSession,
  dir?: string,
): Promise<void> {
  if (session.events.length === 0) return;

  const obsDir = dir ?? defaultObservationsDir();
  await fs.mkdir(obsDir, { recursive: true });

  const filePath = path.join(obsDir, `${session.sessionId}.jsonl`);
  const lines = session.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.appendFile(filePath, lines, "utf-8");

  session.events.length = 0;
}

export async function readObservationEvents(
  sessionId: string,
  dir?: string,
): Promise<ObservationEvent[]> {
  const obsDir = dir ?? defaultObservationsDir();
  const filePath = path.join(obsDir, `${sessionId}.jsonl`);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ObservationEvent);
  } catch {
    return [];
  }
}

export function getSessionStats(session: ObservationSession): string {
  const elapsed = Math.round((Date.now() - session.startedAt) / 60_000);
  const s = session.stats;
  const parts = [
    `Session: ${elapsed} min`,
    `Tools: ${s.toolCalls} calls (${s.toolErrors} error${s.toolErrors !== 1 ? "s" : ""})`,
    `Files: ${s.fileChanges} changed`,
    `Blockers: ${s.blockers}`,
    `Milestones: ${s.milestones}`,
  ];
  if (s.topicShifts > 0) parts.push(`Topic shifts: ${s.topicShifts}`);
  if (session.paused) parts.push("(paused)");
  return parts.join(" | ");
}

export async function cleanupOldObservations(
  dir?: string,
  maxAgeDays = 30,
): Promise<void> {
  const obsDir = dir ?? defaultObservationsDir();
  try {
    const files = await fs.readdir(obsDir);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(obsDir, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
      }
    }
  } catch {
    // Directory may not exist yet — that's fine
  }
}

// ── Topic shift detection ──

export function detectTopicShift(
  recentMessages: string[],
  previousMessages: string[],
): { shifted: boolean; newTopics: string[] } {
  const extractKeywords = (msgs: string[]): Set<string> => {
    const words = msgs
      .join(" ")
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    return new Set(words);
  };

  const recent = extractKeywords(recentMessages);
  const previous = extractKeywords(previousMessages);

  if (previous.size === 0) return { shifted: false, newTopics: [] };

  let overlap = 0;
  for (const word of recent) {
    if (previous.has(word)) overlap++;
  }

  const overlapRatio = previous.size > 0 ? overlap / previous.size : 1;
  const shifted = overlapRatio < 0.3;

  const newTopics = shifted
    ? [...recent].filter((w) => !previous.has(w)).slice(0, 5)
    : [];

  return { shifted, newTopics };
}
