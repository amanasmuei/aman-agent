/**
 * Task 2.2 integration test: MirrorEngine wire-up into the memory lifecycle.
 *
 * Strategy: mock the DB (same pattern as test/memory.test.ts) so we don't
 * touch real sqlite, but let the REAL MirrorEngine run so the filesystem
 * effects are observable. Each test isolates by resetting the memory
 * module's singletons via `_resetMemoryForTesting()` and pointing the
 * agent config at a fresh tmp home.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── hoisted: shared mock db visible to vi.mock factories ──────────────────
const { mockDb, currentMemories, currentStoreResult } = vi.hoisted(() => {
  const currentMemories: { value: Record<string, any> } = { value: {} };
  const currentStoreResult: { value: any } = {
    value: { action: "stored", id: "mem-001", type: "fact", confidence: 0.9, tags: [], total: 1, reinforced: 0 },
  };
  let insertCounter = 0;
  const mockDb: any = {
    __mock: true,
    getById: vi.fn((id: string) => currentMemories.value[id] ?? null),
    getAll: vi.fn(() => Object.values(currentMemories.value)),
    getAllForProject: vi.fn((_p: string) => Object.values(currentMemories.value)),
    resolveId: vi.fn((id: string) => (currentMemories.value[id] ? id : null)),
    deleteMemory: vi.fn((id: string) => { delete currentMemories.value[id]; }),
    close: vi.fn(),
    updateTier: vi.fn(),
    addRelation: vi.fn(),
    expireMemory: vi.fn(),
    getVersionHistory: vi.fn().mockReturnValue([]),
    // Used by syncFromMirrorDir: dedup lookup + insert.
    findByContentHash: vi.fn((content: string) => {
      return Object.values(currentMemories.value).find(
        (m: any) => m.content === content,
      ) ?? null;
    }),
    insertMemory: vi.fn((m: any) => {
      const id = m.id ?? `seeded-${++insertCounter}`;
      currentMemories.value[id] = { ...m, id };
      return id;
    }),
  };
  return { mockDb, currentMemories, currentStoreResult };
});

// Mock only the hot paths of amem-core — preserve MirrorEngine & serializers.
vi.mock("@aman_asmuei/amem-core", async () => {
  const actual = await vi.importActual<typeof import("@aman_asmuei/amem-core")>(
    "@aman_asmuei/amem-core"
  );
  return {
    ...actual,
    createDatabase: vi.fn().mockReturnValue(mockDb),
    preloadEmbeddings: vi.fn(),
    buildVectorIndex: vi.fn(),
    storeMemory: vi.fn(async () => currentStoreResult.value),
    generateEmbedding: vi.fn().mockResolvedValue(null),
    recallMemories: vi.fn(() => []),
    getVectorIndex: vi.fn().mockReturnValue(null),
  };
});

// Use a per-test tmp home so config.json isolation works. We set AMAN_HOME
// before each test and delete the dir after.
let tmpHome: string;

// Import the memory module once — initMemory is called per-test after a
// reset, so singletons re-initialize against the current env+config.
import { initMemory, memoryStore, memoryForget, startupAutoSync, _resetMemoryForTesting } from "../src/memory.js";

function makeMemory(id: string, overrides: Partial<any> = {}): any {
  const now = Date.now();
  return {
    id,
    content: overrides.content ?? `content for ${id}`,
    type: overrides.type ?? "fact",
    tags: overrides.tags ?? ["x"],
    confidence: 0.9,
    accessCount: 0,
    createdAt: now,
    lastAccessed: now,
    source: "test",
    embedding: null,
    scope: "global",
    validFrom: now,
    validUntil: null,
    tier: overrides.tier ?? "core",
    utilityScore: 0,
    ...overrides,
  };
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aman-mirror-test-"));
  process.env.AMAN_HOME = tmpHome;
  // Point amem db at a throwaway path (mocked createDatabase ignores it).
  process.env.AMEM_DIR = path.join(tmpHome, ".amem");
  process.env.AMEM_DB = path.join(tmpHome, ".amem", "memory.db");
  _resetMemoryForTesting();
  // Reset per-test state
  Object.keys(currentMemories.value).forEach((k) => delete currentMemories.value[k]);
  currentStoreResult.value = { action: "stored", id: "mem-001", type: "fact", confidence: 0.9, tags: [], total: 1, reinforced: 0 };
});

afterEach(() => {
  delete process.env.AMAN_HOME;
  delete process.env.AMEM_DIR;
  delete process.env.AMEM_DB;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  _resetMemoryForTesting();
});

describe("MirrorEngine wire-up", () => {
  it("writes a mirror file after memoryStore", async () => {
    await initMemory("test-project");

    const mem = makeMemory("mem-001", { content: "foo bar", type: "fact" });
    currentMemories.value["mem-001"] = mem;
    currentStoreResult.value = { action: "stored", id: "mem-001", type: "fact", confidence: 0.9, tags: ["x"], total: 1, reinforced: 0 };

    await memoryStore({ content: "foo bar", type: "fact", tags: ["x"] });

    // Default mirror dir is homeDir()/memories => <AMAN_HOME>/memories
    const mirrorFile = path.join(tmpHome, "memories", "fact", "mem-001.md");
    // onSave is fire-and-forget but uses sync fs writes internally — file
    // should exist once the awaited promise chain yields control.
    await new Promise((r) => setImmediate(r));
    expect(fs.existsSync(mirrorFile)).toBe(true);
    const content = fs.readFileSync(mirrorFile, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("name: mem-001");
    expect(content).toContain("amem_id: mem-001");
    expect(content).toContain("foo bar");
  });

  it("removes the mirror file after memoryForget", async () => {
    await initMemory("test-project");

    const mem = makeMemory("mem-002", { content: "ephemeral", type: "fact" });
    currentMemories.value["mem-002"] = mem;
    currentStoreResult.value = { action: "stored", id: "mem-002", type: "fact", confidence: 0.9, tags: [], total: 1, reinforced: 0 };

    await memoryStore({ content: "ephemeral", type: "fact" });
    await new Promise((r) => setImmediate(r));

    const mirrorFile = path.join(tmpHome, "memories", "fact", "mem-002.md");
    expect(fs.existsSync(mirrorFile)).toBe(true);

    // Simulate DB still carrying the memory until deleteMemory runs; memoryForget
    // calls getById(fullId) first, then deleteMemory, then our onDelete hook.
    const result = await memoryForget({ id: "mem-002" });
    expect(result.deleted).toBe(1);
    await new Promise((r) => setImmediate(r));

    expect(fs.existsSync(mirrorFile)).toBe(false);
  });

  it("does not write mirror files when config has mirror.enabled=false", async () => {
    // Pre-seed config.json disabling the mirror
    const cfgDir = tmpHome;
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4",
        mirror: { enabled: false },
      }),
      "utf-8",
    );

    await initMemory("test-project");

    const mem = makeMemory("mem-003", { content: "hidden", type: "fact" });
    currentMemories.value["mem-003"] = mem;
    currentStoreResult.value = { action: "stored", id: "mem-003", type: "fact", confidence: 0.9, tags: [], total: 1, reinforced: 0 };

    await memoryStore({ content: "hidden", type: "fact" });
    await new Promise((r) => setImmediate(r));

    const memoriesDir = path.join(tmpHome, "memories");
    if (fs.existsSync(memoriesDir)) {
      // Directory may have been created by some unrelated step, but
      // it must not contain a fact/mem-003.md file.
      expect(fs.existsSync(path.join(memoriesDir, "fact", "mem-003.md"))).toBe(false);
    } else {
      expect(fs.existsSync(memoriesDir)).toBe(false);
    }
  });

  it("memoryStore still succeeds when the mirror write fails", async () => {
    // Point the mirror at an un-writable path. "\0" is rejected by Node's fs.
    const badDir = path.join(tmpHome, "bad\0dir");
    fs.mkdirSync(tmpHome, { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, "config.json"),
      JSON.stringify({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4",
        mirror: { enabled: true, dir: badDir },
      }),
      "utf-8",
    );

    // Silence expected MirrorEngine onError warnings.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await initMemory("test-project");

    const mem = makeMemory("mem-004", { content: "still stored", type: "fact" });
    currentMemories.value["mem-004"] = mem;
    currentStoreResult.value = { action: "stored", id: "mem-004", type: "fact", confidence: 0.9, tags: [], total: 1, reinforced: 0 };

    // Must not throw
    const result = await memoryStore({ content: "still stored", type: "fact" });
    await new Promise((r) => setImmediate(r));

    expect(result.action).toBe("stored");
    expect(result.id).toBe("mem-004");
    // DB still has the memory
    expect(currentMemories.value["mem-004"]).toBeDefined();

    warnSpy.mockRestore();
  });
});

describe("startupAutoSync", () => {
  // Helper: write a minimal mirror-format .md file that parseFrontmatter
  // + extractAmemFields will both accept. The shape mirrors what
  // MirrorEngine.serializeMemoryFile emits (see Task 2.2 test above).
  function seedMirrorFile(
    dir: string,
    type: string,
    id: string,
    body: string,
    extraFrontmatter: Record<string, string> = {},
  ): string {
    const full = path.join(dir, type, `${id}.md`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const lines = [
      "---",
      `name: ${id}`,
      `type: ${type}`,
      `description: seed for ${id}`,
      `amem_id: ${id}`,
      `amem_type: ${type}`,
      "amem_confidence: 0.85",
      "amem_tags: seed,test",
      ...Object.entries(extraFrontmatter).map(([k, v]) => `${k}: ${v}`),
      "---",
      "",
      body,
      "",
    ];
    fs.writeFileSync(full, lines.join("\n"), "utf-8");
    return full;
  }

  it("imports pre-seeded mirror files on startup when autoSyncOnStartup=true (default)", async () => {
    // Seed the mirror dir BEFORE initMemory. Default dir is <AMAN_HOME>/memories.
    const mirrorDir = path.join(tmpHome, "memories");
    seedMirrorFile(mirrorDir, "fact", "seed-alpha", "seeded memory body alpha");

    await initMemory("test-project");

    const result = await startupAutoSync();
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);

    // DB now contains the seeded memory.
    const matches = Object.values(currentMemories.value).filter(
      (m: any) => m.content === "seeded memory body alpha",
    );
    expect(matches.length).toBe(1);
  });

  it("does not import when config has autoSyncOnStartup=false", async () => {
    const mirrorDir = path.join(tmpHome, "memories");
    seedMirrorFile(mirrorDir, "fact", "seed-beta", "seeded memory body beta");

    // Pre-seed config.json disabling auto-sync (mirror still enabled).
    fs.writeFileSync(
      path.join(tmpHome, "config.json"),
      JSON.stringify({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4",
        mirror: { enabled: true, autoSyncOnStartup: false },
      }),
      "utf-8",
    );

    await initMemory("test-project");

    const result = await startupAutoSync();
    expect(result).toBeNull(); // fast no-op contract

    // DB should NOT contain the seeded memory.
    const matches = Object.values(currentMemories.value).filter(
      (m: any) => m.content === "seeded memory body beta",
    );
    expect(matches.length).toBe(0);
  });

  it("continues past a malformed mirror file and imports the valid ones", async () => {
    const mirrorDir = path.join(tmpHome, "memories");
    // One valid file.
    seedMirrorFile(mirrorDir, "fact", "seed-good", "good memory body");
    // One malformed file (no closing frontmatter delimiter).
    const badPath = path.join(mirrorDir, "fact", "seed-bad.md");
    fs.writeFileSync(badPath, "---\nname: seed-bad\ntype: fact\n\nNever closes.\n", "utf-8");

    await initMemory("test-project");

    // Must not throw.
    const result = await startupAutoSync();
    expect(result).not.toBeNull();
    // At least the good one imports; the bad one is skipped.
    expect(result!.imported).toBeGreaterThanOrEqual(1);
    const good = Object.values(currentMemories.value).filter(
      (m: any) => m.content === "good memory body",
    );
    expect(good.length).toBe(1);
  });
});
