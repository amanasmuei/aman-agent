import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpHome = path.join(
  os.tmpdir(),
  `aman-agent-test-sched-${Date.now()}`,
);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const {
  loadSchedules,
  saveSchedules,
  addSchedule,
  removeSchedule,
  getDueTasks,
  isDue,
  markRun,
} = await import("../src/scheduler.js");

describe("scheduler", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpHome, ".aman-agent"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("loadSchedules", () => {
    it("returns empty array when no file exists", () => {
      // Remove the dir so file doesn't exist
      fs.rmSync(path.join(tmpHome, ".aman-agent"), {
        recursive: true,
        force: true,
      });
      expect(loadSchedules()).toEqual([]);
    });

    it("returns empty array on invalid JSON", () => {
      fs.writeFileSync(
        path.join(tmpHome, ".aman-agent", "schedules.json"),
        "not json",
        "utf-8",
      );
      expect(loadSchedules()).toEqual([]);
    });

    it("returns tasks from file", () => {
      const tasks = [
        {
          id: "abc",
          name: "Test",
          schedule: "daily 9am",
          action: "notify",
          mode: "notify",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ];
      fs.writeFileSync(
        path.join(tmpHome, ".aman-agent", "schedules.json"),
        JSON.stringify(tasks),
        "utf-8",
      );
      expect(loadSchedules()).toEqual(tasks);
    });
  });

  describe("saveSchedules", () => {
    it("creates dir and writes file", () => {
      fs.rmSync(path.join(tmpHome, ".aman-agent"), {
        recursive: true,
        force: true,
      });
      saveSchedules([]);
      const content = fs.readFileSync(
        path.join(tmpHome, ".aman-agent", "schedules.json"),
        "utf-8",
      );
      expect(JSON.parse(content)).toEqual([]);
    });
  });

  describe("addSchedule", () => {
    it("adds a task with generated id and createdAt", () => {
      const task = addSchedule({
        name: "Standup",
        schedule: "weekdays 9am",
        action: "notify",
        mode: "notify",
      });
      expect(task.id).toBeDefined();
      expect(task.createdAt).toBeDefined();
      expect(task.name).toBe("Standup");
      expect(loadSchedules()).toHaveLength(1);
    });

    it("appends to existing tasks", () => {
      addSchedule({
        name: "Task 1",
        schedule: "daily 9am",
        action: "notify",
        mode: "notify",
      });
      addSchedule({
        name: "Task 2",
        schedule: "weekly friday",
        action: "notify",
        mode: "notify",
      });
      expect(loadSchedules()).toHaveLength(2);
    });
  });

  describe("removeSchedule", () => {
    it("removes an existing task", () => {
      const task = addSchedule({
        name: "Remove me",
        schedule: "daily",
        action: "notify",
        mode: "notify",
      });
      expect(removeSchedule(task.id)).toBe(true);
      expect(loadSchedules()).toHaveLength(0);
    });

    it("returns false for non-existent id", () => {
      expect(removeSchedule("nonexistent")).toBe(false);
    });
  });

  describe("isDue", () => {
    it("returns true for daily when 24h passed", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-02T10:00:00Z");
      expect(isDue("daily 9am", lastRun, now)).toBe(true);
    });

    it("returns false for daily when only 10h passed", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-01T19:00:00Z");
      expect(isDue("daily 9am", lastRun, now)).toBe(false);
    });

    it("returns true for every 2h when 3h passed", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-01T12:00:00Z");
      expect(isDue("every 2h", lastRun, now)).toBe(true);
    });

    it("returns false for every 2h when only 1h passed", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-01T10:00:00Z");
      expect(isDue("every 2h", lastRun, now)).toBe(false);
    });

    it("returns true for weekdays on a weekday", () => {
      // 2025-01-06 is a Monday
      const lastRun = new Date("2025-01-05T09:00:00Z");
      const now = new Date("2025-01-06T10:00:00Z");
      expect(isDue("weekdays 9am", lastRun, now)).toBe(true);
    });

    it("returns false for weekdays on a weekend", () => {
      // 2025-01-04 is a Saturday
      const lastRun = new Date("2025-01-03T09:00:00Z");
      const now = new Date("2025-01-04T10:00:00Z");
      expect(isDue("weekdays 9am", lastRun, now)).toBe(false);
    });

    it("returns true for weekly when 7+ days passed", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-08T10:00:00Z");
      expect(isDue("weekly friday", lastRun, now)).toBe(true);
    });

    it("returns false for weekly when only 2 days passed", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-03T10:00:00Z");
      expect(isDue("weekly friday", lastRun, now)).toBe(false);
    });

    it("returns false for unknown schedule format", () => {
      const lastRun = new Date("2025-01-01T09:00:00Z");
      const now = new Date("2025-01-02T10:00:00Z");
      expect(isDue("unknown", lastRun, now)).toBe(false);
    });
  });

  describe("getDueTasks", () => {
    it("returns tasks that have never run", () => {
      addSchedule({
        name: "Never run",
        schedule: "daily",
        action: "notify",
        mode: "notify",
      });
      expect(getDueTasks()).toHaveLength(1);
    });
  });

  describe("markRun", () => {
    it("updates lastRun timestamp", () => {
      const task = addSchedule({
        name: "Mark me",
        schedule: "daily",
        action: "notify",
        mode: "notify",
      });
      expect(task.lastRun).toBeUndefined();
      markRun(task.id);
      const tasks = loadSchedules();
      expect(tasks[0].lastRun).toBeDefined();
    });

    it("does nothing for non-existent id", () => {
      markRun("nonexistent");
      // No error thrown
    });
  });
});
