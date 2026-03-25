import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpHome = path.join(os.tmpdir(), `aman-agent-test-logger-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const { log, LOG_PATH } = await import("../src/logger.js");

describe("logger", () => {
  beforeEach(() => {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes a debug log entry to file", () => {
    log.debug("agent", "test message");
    const content = fs.readFileSync(LOG_PATH, "utf-8");
    expect(content).toContain('"level":"debug"');
    expect(content).toContain('"module":"agent"');
    expect(content).toContain('"message":"test message"');
  });

  it("writes warn and error levels", () => {
    log.warn("hooks", "warn msg");
    log.error("mcp", "error msg", new Error("test"));
    const content = fs.readFileSync(LOG_PATH, "utf-8");
    expect(content).toContain('"level":"warn"');
    expect(content).toContain('"level":"error"');
    expect(content).toContain("test");
  });

  it("each line is valid JSON", () => {
    log.debug("a", "msg1");
    log.warn("b", "msg2");
    const lines = fs.readFileSync(LOG_PATH, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("rotates log file when exceeding 1MB", () => {
    const bigMsg = "x".repeat(1000);
    for (let i = 0; i < 1100; i++) {
      log.debug("test", bigMsg);
    }
    const backupPath = LOG_PATH + ".1";
    expect(fs.existsSync(backupPath)).toBe(true);
  });
});
