import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { handleWorkspacesCommand } from "../src/commands/workspaces.js";
import { recordWorkspace } from "../src/workspaces/tracker.js";

const FAKE_CTX = {} as never;

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aman-agent-ws-cmd-"));
  originalEnv = process.env.AMAN_AGENT_HOME;
  process.env.AMAN_AGENT_HOME = tmp;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.AMAN_AGENT_HOME;
  else process.env.AMAN_AGENT_HOME = originalEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
}

function makeRepo(name: string): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  gitInit(dir);
  return dir;
}

describe("handleWorkspacesCommand", () => {
  it("'list' (no action) shows active workspaces newest-first", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await new Promise((r) => setTimeout(r, 10));
    await recordWorkspace(makeRepo("beta"));
    const result = await handleWorkspacesCommand("", [], FAKE_CTX);
    expect(result.handled).toBe(true);
    expect(result.output).toContain("beta");
    expect(result.output).toContain("alpha");
    const idxBeta = result.output!.indexOf("beta");
    const idxAlpha = result.output!.indexOf("alpha");
    expect(idxBeta).toBeLessThan(idxAlpha);
  });

  it("'all' includes archived (with marker)", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const { archiveWorkspace } = await import("../src/workspaces/tracker.js");
    await archiveWorkspace("alpha");
    const result = await handleWorkspacesCommand("all", [], FAKE_CTX);
    expect(result.output).toContain("alpha");
    expect(result.output).toMatch(/archived/i);
  });

  it("'archive <name>' archives", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const result = await handleWorkspacesCommand(
      "archive",
      ["alpha"],
      FAKE_CTX,
    );
    expect(result.handled).toBe(true);
    expect(result.output).toMatch(/archived/i);
  });

  it("'unarchive <name>' un-archives", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const { archiveWorkspace } = await import("../src/workspaces/tracker.js");
    await archiveWorkspace("alpha");
    const result = await handleWorkspacesCommand(
      "unarchive",
      ["alpha"],
      FAKE_CTX,
    );
    expect(result.output).toMatch(/unarchived|active/i);
  });

  it("'notes <name> <text...>' sets notes", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const result = await handleWorkspacesCommand(
      "notes",
      ["alpha", "scratch", "experiment"],
      FAKE_CTX,
    );
    expect(result.output).toMatch(/notes/i);
  });

  it("'forget <name>' removes the entry", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const result = await handleWorkspacesCommand(
      "forget",
      ["alpha"],
      FAKE_CTX,
    );
    expect(result.output).toMatch(/forgot|removed/i);
  });

  it("returns a helpful error for unknown action", async () => {
    const result = await handleWorkspacesCommand("zoiks", [], FAKE_CTX);
    expect(result.handled).toBe(true);
    expect(result.output).toMatch(/unknown|usage/i);
  });
});
