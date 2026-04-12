import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock context builder
vi.mock("../../src/dev/context-builder.js", () => ({
  buildContext: vi.fn(async (stack) => ({
    stack,
    conventions: ["Use fmt.Errorf for wrapping"],
    decisions: ["Chose PostgreSQL"],
    corrections: ["Never log.Fatal"],
    preferences: ["Structured logging"],
    rules: ["No secrets in git"],
    metadata: { generatedAt: Date.now(), mode: "template", memoriesUsed: 4 },
  })),
}));

import { runDev } from "../../src/dev/dev-command.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `dev-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "go.mod"), "module github.com/test/app\n\ngo 1.22\n");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runDev", () => {
  it("generates CLAUDE.md and returns success", async () => {
    const result = await runDev(tmpDir, { noLaunch: true });
    expect(result.success).toBe(true);
    expect(result.generated).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(true);
  });

  it("skips generation when CLAUDE.md is fresh", async () => {
    await runDev(tmpDir, { noLaunch: true });
    const result = await runDev(tmpDir, { noLaunch: true });
    expect(result.generated).toBe(false);
    expect(result.skippedReason).toBe("fresh");
  });

  it("regenerates with --force", async () => {
    await runDev(tmpDir, { noLaunch: true });
    const result = await runDev(tmpDir, { noLaunch: true, force: true });
    expect(result.generated).toBe(true);
  });

  it("returns diff without writing with --diff", async () => {
    const result = await runDev(tmpDir, { noLaunch: true, diff: true });
    expect(result.diff).toBeTruthy();
    expect(result.generated).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
  });

  it("adds CLAUDE.md to .gitignore", async () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");
    await runDev(tmpDir, { noLaunch: true });
    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("CLAUDE.md");
  });

  it("works with empty project (no stack files)", async () => {
    const emptyDir = path.join(os.tmpdir(), `empty-${Date.now()}`);
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = await runDev(emptyDir, { noLaunch: true });
    expect(result.success).toBe(true);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns error for nonexistent directory", async () => {
    const result = await runDev("/nonexistent/path", { noLaunch: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
