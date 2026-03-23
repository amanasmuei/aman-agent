import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpHome = path.join(
  os.tmpdir(),
  `aman-agent-test-notif-${Date.now()}`,
);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const { checkNotifications, displayNotifications } = await import(
  "../src/notifications.js"
);
const { addSchedule } = await import("../src/scheduler.js");

describe("notifications", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpHome, ".aman-agent"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("checkNotifications", () => {
    it("returns empty array when nothing is due", () => {
      // No schedules, no eval file
      const notifications = checkNotifications();
      expect(notifications).toEqual([]);
    });

    it("includes due scheduled tasks", () => {
      addSchedule({
        name: "Standup",
        schedule: "daily 9am",
        action: "notify",
        mode: "notify",
      });
      const notifications = checkNotifications();
      expect(notifications.length).toBeGreaterThanOrEqual(1);
      expect(notifications.some((n) => n.type === "schedule")).toBe(true);
      expect(notifications.some((n) => n.message.includes("Standup"))).toBe(
        true,
      );
    });

    it("includes eval notification when sessions are overdue", () => {
      const evalDir = path.join(tmpHome, ".aeval");
      fs.mkdirSync(evalDir, { recursive: true });
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      fs.writeFileSync(
        path.join(evalDir, "eval.md"),
        `# Eval\n- Last updated: ${oldDate}\n`,
        "utf-8",
      );

      const notifications = checkNotifications();
      expect(notifications.some((n) => n.type === "eval")).toBe(true);
      expect(notifications.some((n) => n.message.includes("No session"))).toBe(
        true,
      );
    });

    it("does not include eval notification when sessions are recent", () => {
      const evalDir = path.join(tmpHome, ".aeval");
      fs.mkdirSync(evalDir, { recursive: true });
      const recentDate = new Date().toISOString().split("T")[0];
      fs.writeFileSync(
        path.join(evalDir, "eval.md"),
        `# Eval\n- Last updated: ${recentDate}\n`,
        "utf-8",
      );

      const notifications = checkNotifications();
      expect(notifications.some((n) => n.type === "eval")).toBe(false);
    });
  });

  describe("displayNotifications", () => {
    it("prints nothing for empty notifications", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      displayNotifications([]);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("prints notifications", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      displayNotifications([
        { type: "schedule", message: "Standup (daily 9am)" },
        { type: "eval", message: "No session logged in 4 days" },
      ]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
