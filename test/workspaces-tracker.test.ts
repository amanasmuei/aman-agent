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

import { recordWorkspace } from "../src/workspaces/tracker.js";
import { loadStore, saveStore } from "../src/workspaces/store.js";

describe("recordWorkspace", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("creates a new entry on first record (firstSeen == lastSeen)", async () => {
    const repo = makeRepo("alpha");
    const entry = await recordWorkspace(repo);
    expect(entry.name).toBe("alpha");
    expect(entry.archived).toBe(false);
    expect(entry.firstSeen).toBe(entry.lastSeen);
    const store = await loadStore();
    expect(store.workspaces).toHaveLength(1);
  });

  it("touches lastSeen on second record (firstSeen unchanged)", async () => {
    const repo = makeRepo("alpha");
    const first = await recordWorkspace(repo);
    await new Promise((r) => setTimeout(r, 10));
    const second = await recordWorkspace(repo);
    expect(second.firstSeen).toBe(first.firstSeen);
    expect(new Date(second.lastSeen).getTime()).toBeGreaterThan(
      new Date(first.lastSeen).getTime(),
    );
    const store = await loadStore();
    expect(store.workspaces).toHaveLength(1);
  });

  it("revives an archived entry (archived -> false on touch)", async () => {
    const repo = makeRepo("alpha");
    await recordWorkspace(repo);
    const store = await loadStore();
    store.workspaces[0].archived = true;
    await saveStore(store);
    const revived = await recordWorkspace(repo);
    expect(revived.archived).toBe(false);
  });

  it("auto-archives the oldest active when 8th workspace is recorded", async () => {
    for (let i = 0; i < 8; i++) {
      const repo = makeRepo(`repo-${i}`);
      await recordWorkspace(repo);
      await new Promise((r) => setTimeout(r, 5));
    }
    const store = await loadStore();
    const active = store.workspaces.filter((w) => !w.archived);
    const archived = store.workspaces.filter((w) => w.archived);
    expect(active).toHaveLength(7);
    expect(archived).toHaveLength(1);
    expect(archived[0].name).toBe("repo-0");
  });
});
