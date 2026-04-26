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

import {
  listWorkspaces,
  archiveWorkspace,
  unarchiveWorkspace,
} from "../src/workspaces/tracker.js";

describe("listWorkspaces", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, `list-${name}`);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("returns active only by default, newest lastSeen first", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await new Promise((r) => setTimeout(r, 10));
    await recordWorkspace(makeRepo("beta"));
    const list = await listWorkspaces();
    expect(list.map((w) => w.name)).toEqual(["list-beta", "list-alpha"]);
  });

  it("includes archived when includeArchived=true", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await archiveWorkspace("list-alpha");
    const activeOnly = await listWorkspaces();
    expect(activeOnly).toHaveLength(0);
    const all = await listWorkspaces({ includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0].archived).toBe(true);
  });
});

describe("archiveWorkspace / unarchiveWorkspace", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, `arch-${name}`);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("archives by name", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await archiveWorkspace("arch-alpha");
    const all = await listWorkspaces({ includeArchived: true });
    expect(all[0].archived).toBe(true);
  });

  it("unarchives by name", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await archiveWorkspace("arch-alpha");
    await unarchiveWorkspace("arch-alpha");
    const list = await listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].archived).toBe(false);
  });

  it("throws when name not found (helpful error)", async () => {
    await expect(archiveWorkspace("nonexistent")).rejects.toThrow(
      /not found/i,
    );
  });

  it("throws when name is ambiguous", async () => {
    const root1 = path.join(tmp, "ambiguous-1");
    const root2 = path.join(tmp, "ambiguous-2");
    fs.mkdirSync(path.join(root1, "shared-name"), { recursive: true });
    fs.mkdirSync(path.join(root2, "shared-name"), { recursive: true });
    gitInit(path.join(root1, "shared-name"));
    gitInit(path.join(root2, "shared-name"));
    await recordWorkspace(path.join(root1, "shared-name"));
    await recordWorkspace(path.join(root2, "shared-name"));
    await expect(archiveWorkspace("shared-name")).rejects.toThrow(
      /ambiguous|multiple/i,
    );
  });
});
