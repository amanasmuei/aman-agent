import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createObservationSession,
  recordEvent,
  pauseObservation,
  resumeObservation,
  flushEvents,
  getSessionStats,
  cleanupOldObservations,
  readObservationEvents,
} from "../src/observation.js";

// Use a temp dir for test isolation
let testDir: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `obs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("createObservationSession", () => {
  it("creates a session with correct initial state", () => {
    const session = createObservationSession("test-123");
    expect(session.sessionId).toBe("test-123");
    expect(session.events).toEqual([]);
    expect(session.paused).toBe(false);
    expect(session.stats.toolCalls).toBe(0);
    expect(session.stats.toolErrors).toBe(0);
    expect(session.stats.topicShifts).toBe(0);
    expect(session.stats.blockers).toBe(0);
    expect(session.stats.milestones).toBe(0);
    expect(session.stats.fileChanges).toBe(0);
    expect(session.startedAt).toBeGreaterThan(0);
  });
});

describe("recordEvent", () => {
  it("appends event with timestamp and updates stats", () => {
    const session = createObservationSession("test-123");
    recordEvent(session, {
      type: "tool_call",
      summary: "Called file_read",
      data: { tool: "file_read", success: true, durationMs: 120 },
    });
    expect(session.events).toHaveLength(1);
    expect(session.events[0].timestamp).toBeGreaterThan(0);
    expect(session.events[0].type).toBe("tool_call");
    expect(session.stats.toolCalls).toBe(1);
  });

  it("increments correct stat counter for each event type", () => {
    const session = createObservationSession("test-123");
    recordEvent(session, { type: "tool_call", summary: "t1", data: {} });
    recordEvent(session, { type: "tool_error", summary: "e1", data: {} });
    recordEvent(session, { type: "tool_error", summary: "e2", data: {} });
    recordEvent(session, { type: "blocker", summary: "b1", data: {} });
    recordEvent(session, { type: "milestone", summary: "m1", data: {} });
    recordEvent(session, { type: "file_change", summary: "f1", data: {} });
    recordEvent(session, { type: "topic_shift", summary: "ts1", data: {} });
    expect(session.stats.toolCalls).toBe(1);
    expect(session.stats.toolErrors).toBe(2);
    expect(session.stats.blockers).toBe(1);
    expect(session.stats.milestones).toBe(1);
    expect(session.stats.fileChanges).toBe(1);
    expect(session.stats.topicShifts).toBe(1);
  });

  it("does not record when paused", () => {
    const session = createObservationSession("test-123");
    pauseObservation(session);
    recordEvent(session, { type: "tool_call", summary: "ignored", data: {} });
    expect(session.events).toHaveLength(0);
    expect(session.stats.toolCalls).toBe(0);
  });
});

describe("pauseObservation / resumeObservation", () => {
  it("toggles paused state", () => {
    const session = createObservationSession("test-123");
    expect(session.paused).toBe(false);
    pauseObservation(session);
    expect(session.paused).toBe(true);
    resumeObservation(session);
    expect(session.paused).toBe(false);
  });
});

describe("flushEvents", () => {
  it("writes events to JSONL file and clears buffer", async () => {
    const session = createObservationSession("test-123");
    recordEvent(session, { type: "tool_call", summary: "t1", data: { tool: "file_read" } });
    recordEvent(session, { type: "tool_error", summary: "e1", data: { tool: "file_write", error: "ENOENT" } });

    await flushEvents(session, testDir);

    expect(session.events).toHaveLength(0);

    const filePath = path.join(testDir, "test-123.jsonl");
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]);
    expect(parsed0.type).toBe("tool_call");
    expect(parsed0.summary).toBe("t1");
  });

  it("appends on subsequent flushes", async () => {
    const session = createObservationSession("test-123");
    recordEvent(session, { type: "tool_call", summary: "t1", data: {} });
    await flushEvents(session, testDir);

    recordEvent(session, { type: "blocker", summary: "b1", data: {} });
    await flushEvents(session, testDir);

    const filePath = path.join(testDir, "test-123.jsonl");
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).type).toBe("blocker");
  });

  it("does nothing when events array is empty", async () => {
    const session = createObservationSession("test-123");
    await flushEvents(session, testDir);
    const files = await fs.readdir(testDir);
    expect(files).toHaveLength(0);
  });
});

describe("readObservationEvents", () => {
  it("reads all events from JSONL file", async () => {
    const session = createObservationSession("test-456");
    recordEvent(session, { type: "tool_call", summary: "t1", data: {} });
    recordEvent(session, { type: "milestone", summary: "m1", data: {} });
    await flushEvents(session, testDir);

    const events = await readObservationEvents("test-456", testDir);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("tool_call");
    expect(events[1].type).toBe("milestone");
  });

  it("returns empty array when file does not exist", async () => {
    const events = await readObservationEvents("nonexistent", testDir);
    expect(events).toEqual([]);
  });
});

describe("getSessionStats", () => {
  it("returns formatted stats string", () => {
    const session = createObservationSession("test-123");
    recordEvent(session, { type: "tool_call", summary: "t1", data: {} });
    recordEvent(session, { type: "tool_call", summary: "t2", data: {} });
    recordEvent(session, { type: "tool_error", summary: "e1", data: {} });
    recordEvent(session, { type: "file_change", summary: "f1", data: {} });

    const stats = getSessionStats(session);
    expect(stats).toContain("2 calls");
    expect(stats).toContain("1 error");
    expect(stats).toContain("1 changed");
  });
});

describe("cleanupOldObservations", () => {
  it("deletes files older than maxAgeDays", async () => {
    // Create a fake old file
    const oldFile = path.join(testDir, "old-session.jsonl");
    await fs.writeFile(oldFile, '{"type":"tool_call"}\n');
    // Set mtime to 60 days ago
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldFile, sixtyDaysAgo, sixtyDaysAgo);

    // Create a recent file
    const newFile = path.join(testDir, "new-session.jsonl");
    await fs.writeFile(newFile, '{"type":"tool_call"}\n');

    await cleanupOldObservations(testDir, 30);

    const files = await fs.readdir(testDir);
    expect(files).toEqual(["new-session.jsonl"]);
  });
});
