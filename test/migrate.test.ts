import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpHome = path.join(os.tmpdir(), `aman-agent-test-migrate-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const { migrateIfNeeded } = await import("../src/migrate.js");

describe("migrateIfNeeded", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.AMAN_HOME;
    delete process.env.AMAN_AGENT_HOME;
  });

  it("does nothing when no old directories exist", () => {
    const result = migrateIfNeeded();
    expect(result.migrated).toEqual([]);
  });

  it("migrates ~/.acore to ~/.aman-agent/identity", () => {
    const oldDir = path.join(tmpHome, ".acore");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "core.md"), "# test identity");

    const result = migrateIfNeeded();

    expect(result.migrated).toContain("identity");
    const newFile = path.join(tmpHome, ".aman-agent", "identity", "core.md");
    expect(fs.existsSync(newFile)).toBe(true);
    expect(fs.readFileSync(newFile, "utf-8")).toBe("# test identity");
    expect(fs.existsSync(oldDir)).toBe(false);
  });

  it("migrates ~/.arules to ~/.aman-agent/rules", () => {
    const oldDir = path.join(tmpHome, ".arules");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "rules.md"), "# test rules");

    const result = migrateIfNeeded();

    expect(result.migrated).toContain("rules");
    expect(fs.existsSync(path.join(tmpHome, ".aman-agent", "rules", "rules.md"))).toBe(true);
  });

  it("migrates ~/.amem to ~/.aman-agent/memory", () => {
    const oldDir = path.join(tmpHome, ".amem");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "memory.db"), "fake-db");

    const result = migrateIfNeeded();

    expect(result.migrated).toContain("memory");
    expect(fs.existsSync(path.join(tmpHome, ".aman-agent", "memory", "memory.db"))).toBe(true);
  });

  it("does not overwrite existing new directory with content", () => {
    const newDir = path.join(tmpHome, ".aman-agent", "identity");
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "core.md"), "# existing");

    const oldDir = path.join(tmpHome, ".acore");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "core.md"), "# old");

    const result = migrateIfNeeded();

    expect(result.migrated).not.toContain("identity");
    expect(fs.readFileSync(path.join(newDir, "core.md"), "utf-8")).toBe("# existing");
  });

  it("is idempotent — second call does nothing", () => {
    const oldDir = path.join(tmpHome, ".acore");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "core.md"), "# test");

    migrateIfNeeded();
    const result2 = migrateIfNeeded();

    expect(result2.migrated).toEqual([]);
  });
});
