import { describe, it, expect, afterEach, vi } from "vitest";
import { parseTime, setReminder, clearReminders, getActiveCount } from "../src/reminders.js";

// Mock setTimeout/clearTimeout to avoid real timers in tests
vi.useFakeTimers();

describe("reminders", () => {
  afterEach(() => {
    clearReminders();
    vi.clearAllTimers();
  });

  describe("parseTime", () => {
    it("parses minutes", () => {
      expect(parseTime("5m")).toBe(5 * 60 * 1000);
      expect(parseTime("30m")).toBe(30 * 60 * 1000);
    });

    it("parses hours", () => {
      expect(parseTime("1h")).toBe(60 * 60 * 1000);
      expect(parseTime("2h")).toBe(2 * 60 * 60 * 1000);
    });

    it("parses tomorrow", () => {
      expect(parseTime("tomorrow")).toBe(24 * 60 * 60 * 1000);
    });

    it("returns null for invalid formats", () => {
      expect(parseTime("abc")).toBeNull();
      expect(parseTime("5d")).toBeNull();
      expect(parseTime("")).toBeNull();
      expect(parseTime("friday")).toBeNull();
    });
  });

  describe("setReminder", () => {
    it("returns duration string for minutes", () => {
      const result = setReminder("30m", "Do something");
      expect(result).toBe("30 minutes");
      expect(getActiveCount()).toBe(1);
    });

    it("returns duration string for hours", () => {
      const result = setReminder("2h", "Deploy");
      expect(result).toBe("2 hours");
    });

    it("returns singular hour", () => {
      const result = setReminder("1h", "Check");
      expect(result).toBe("1 hour");
    });

    it("returns duration string for tomorrow", () => {
      const result = setReminder("tomorrow", "Morning check");
      expect(result).toBe("24 hours");
    });

    it("returns null for invalid time", () => {
      const result = setReminder("invalid", "Nope");
      expect(result).toBeNull();
      expect(getActiveCount()).toBe(0);
    });
  });

  describe("clearReminders", () => {
    it("clears all active reminders", () => {
      setReminder("30m", "One");
      setReminder("1h", "Two");
      expect(getActiveCount()).toBe(2);
      clearReminders();
      expect(getActiveCount()).toBe(0);
    });
  });

  describe("timer fires", () => {
    it("removes reminder from active list when timer fires", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      setReminder("5m", "Fire me");
      expect(getActiveCount()).toBe(1);
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(getActiveCount()).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
