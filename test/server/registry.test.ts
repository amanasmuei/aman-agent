import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { log } from "../../src/logger.js";
import {
  registerAgent,
  unregisterAgent,
  listAgents,
  findAgent,
  type AgentEntry,
} from "../../src/server/registry.js";

function makeEntry(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    name: "test-agent",
    profile: "default",
    pid: process.pid,
    port: 52341,
    token: "abc123",
    started_at: Date.now(),
    version: "0.31.0-next.0",
    ...overrides,
  };
}

describe("registry", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "registry-test-"));
    prevHome = process.env.AMAN_AGENT_HOME;
    process.env.AMAN_AGENT_HOME = home;
  });

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env.AMAN_AGENT_HOME;
    } else {
      process.env.AMAN_AGENT_HOME = prevHome;
    }
    await fs.rm(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates registry.json with mode 0600", async () => {
    const entry = makeEntry();
    await registerAgent(entry);
    const registryPath = path.join(home, "registry.json");
    const stat = await fs.stat(registryPath);
    expect(stat.mode & 0o777).toBe(0o600);
    const raw = JSON.parse(await fs.readFile(registryPath, "utf-8"));
    expect(raw).toHaveLength(1);
    expect(raw[0].name).toBe("test-agent");
  });

  it("merges an entry into an existing registry without clobbering others", async () => {
    await registerAgent(makeEntry({ name: "alpha", port: 52341 }));
    await registerAgent(makeEntry({ name: "beta", port: 52342 }));
    const entries = await listAgents();
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("replaces an entry with the same name (last-write-wins) and logs a warning", async () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    await registerAgent(makeEntry({ name: "dupe", port: 52341, token: "old" }));
    await registerAgent(makeEntry({ name: "dupe", port: 52342, token: "new" }));
    const entries = await listAgents();
    const matching = entries.filter((e) => e.name === "dupe");
    expect(matching).toHaveLength(1);
    expect(matching[0].port).toBe(52342);
    expect(matching[0].token).toBe("new");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("unregisters an existing entry and leaves others untouched", async () => {
    await registerAgent(makeEntry({ name: "alpha" }));
    await registerAgent(makeEntry({ name: "beta" }));
    await unregisterAgent("alpha");
    const entries = await listAgents();
    const names = entries.map((e) => e.name);
    expect(names).toEqual(["beta"]);
  });

  it("unregister on a missing name is a no-op", async () => {
    await registerAgent(makeEntry({ name: "alpha" }));
    const registryPath = path.join(home, "registry.json");
    const before = await fs.readFile(registryPath, "utf-8");
    await expect(unregisterAgent("nonexistent")).resolves.toBeUndefined();
    const after = await fs.readFile(registryPath, "utf-8");
    expect(after).toBe(before);
  });

  it("listAgents returns [] when registry.json does not exist", async () => {
    const entries = await listAgents();
    expect(entries).toEqual([]);
  });

  it("listAgents with isAlive=()=>false prunes dead entries from the return value", async () => {
    await registerAgent(makeEntry({ name: "alpha" }));
    await registerAgent(makeEntry({ name: "beta" }));
    const entries = await listAgents({ isAlive: () => false });
    expect(entries).toEqual([]);
  });

  it("listAgents without prune does not write back to disk", async () => {
    await registerAgent(makeEntry({ name: "alpha" }));
    await registerAgent(makeEntry({ name: "beta" }));
    const registryPath = path.join(home, "registry.json");
    const before = await fs.readFile(registryPath, "utf-8");
    await listAgents({ isAlive: () => false });
    const after = await fs.readFile(registryPath, "utf-8");
    expect(after).toBe(before);
    const parsed = JSON.parse(after) as AgentEntry[];
    expect(parsed).toHaveLength(2);
  });

  it("listAgents with prune: true writes the pruned registry back", async () => {
    await registerAgent(makeEntry({ name: "alpha" }));
    await registerAgent(makeEntry({ name: "beta" }));
    await listAgents({ isAlive: () => false, prune: true });
    const registryPath = path.join(home, "registry.json");
    const raw = JSON.parse(await fs.readFile(registryPath, "utf-8"));
    expect(raw).toEqual([]);
  });

  it("findAgent returns null for missing names and the entry when present", async () => {
    expect(await findAgent("missing")).toBeNull();
    await registerAgent(makeEntry({ name: "found", pid: process.pid }));
    const entry = await findAgent("found");
    expect(entry).not.toBeNull();
    expect(entry?.name).toBe("found");
    expect(await findAgent("still-missing")).toBeNull();
  });

  it("atomic write: if rename fails, the canonical file is untouched", async () => {
    await registerAgent(makeEntry({ name: "original", port: 52341 }));
    const registryPath = path.join(home, "registry.json");
    const originalBytes = await fs.readFile(registryPath, "utf-8");

    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementationOnce(async () => {
        throw new Error("simulated crash between write-temp and rename");
      });

    await expect(
      registerAgent(makeEntry({ name: "new-entry", port: 52342 })),
    ).rejects.toThrow(/simulated crash/);

    renameSpy.mockRestore();

    const afterBytes = await fs.readFile(registryPath, "utf-8");
    expect(afterBytes).toBe(originalBytes);
    const parsed = JSON.parse(afterBytes) as AgentEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("original");
  });
});
