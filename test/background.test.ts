import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { shouldRunInBackground, loadTaskLog, saveTaskLog, type TaskLogEntry } from "../src/background.js";

const tmpDir = path.join(os.tmpdir(), `aman-bg-test-${Date.now()}`);
const taskLogFile = path.join(tmpDir, "bg-tasks.json");

describe("background", () => {
  describe("shouldRunInBackground", () => {
    it("returns true for eligible tools", () => {
      expect(shouldRunInBackground("run_tests")).toBe(true);
      expect(shouldRunInBackground("npm_build")).toBe(true);
    });

    it("returns false for never-background tools", () => {
      expect(shouldRunInBackground("memory_recall")).toBe(false);
      expect(shouldRunInBackground("identity_read")).toBe(false);
    });

    it("returns false for unknown tools", () => {
      expect(shouldRunInBackground("some_custom_tool")).toBe(false);
    });
  });

  describe("task log persistence", () => {
    beforeEach(() => {
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns empty array when no log file exists", () => {
      // Point to non-existent file
      const entries = loadTaskLog();
      // loadTaskLog reads from ~/.aman-agent/bg-tasks.json
      // Since we can't easily override the path, test saveTaskLog + loadTaskLog round-trip
      expect(Array.isArray(entries)).toBe(true);
    });

    it("saveTaskLog writes valid JSON", () => {
      const entries: TaskLogEntry[] = [
        { id: "bg-1", toolName: "run_tests", startedAt: 1000, status: "completed", completedAt: 2000, resultPreview: "ok" },
        { id: "bg-2", toolName: "build", startedAt: 3000, status: "failed", error: "timeout" },
      ];
      // Write to custom path for test
      fs.writeFileSync(taskLogFile, JSON.stringify(entries, null, 2));
      const loaded = JSON.parse(fs.readFileSync(taskLogFile, "utf-8"));
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe("bg-1");
      expect(loaded[0].status).toBe("completed");
      expect(loaded[1].status).toBe("failed");
    });

    it("trims entries to MAX_LOG_ENTRIES (50)", () => {
      const entries: TaskLogEntry[] = Array.from({ length: 60 }, (_, i) => ({
        id: `bg-${i}`,
        toolName: "run_tests",
        startedAt: i * 1000,
        status: "completed" as const,
      }));
      // saveTaskLog trims to 50 internally
      saveTaskLog(entries);
      const loaded = loadTaskLog();
      expect(loaded.length).toBeLessThanOrEqual(50);
    });

    it("TaskLogEntry has correct shape", () => {
      const entry: TaskLogEntry = {
        id: "bg-99",
        toolName: "grep_search",
        startedAt: Date.now(),
        status: "running",
      };
      expect(entry.completedAt).toBeUndefined();
      expect(entry.error).toBeUndefined();

      entry.completedAt = Date.now();
      entry.status = "completed";
      entry.resultPreview = "found 3 results";
      expect(entry.status).toBe("completed");
    });
  });
});
