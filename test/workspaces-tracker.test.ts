import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { identifyWorkspace } from "../src/workspaces/tracker.js";

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aman-agent-ws-tracker-"));
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

describe("identifyWorkspace", () => {
  it("returns the git root when cwd is inside a git repo", async () => {
    const repoDir = path.join(tmp, "my-repo");
    fs.mkdirSync(repoDir);
    gitInit(repoDir);
    const subDir = path.join(repoDir, "src", "nested");
    fs.mkdirSync(subDir, { recursive: true });
    const result = await identifyWorkspace(subDir);
    // Use realpath for comparison; macOS /var → /private/var symlink
    expect(result.path).toBe(fs.realpathSync(repoDir));
    expect(result.name).toBe("my-repo");
  });

  it("returns the absolute cwd path when not in a git repo", async () => {
    const nonRepoDir = path.join(tmp, "scratch");
    fs.mkdirSync(nonRepoDir);
    const result = await identifyWorkspace(nonRepoDir);
    expect(result.path).toBe(fs.realpathSync(nonRepoDir));
    expect(result.name).toBe("scratch");
  });
});
