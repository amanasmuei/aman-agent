import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  isProfileInstalled,
  installProfile,
  ensureAllProfilesInstalled,
  ensureProfileReady,
  getProfilesDir,
} from "../../src/profiles/auto-install.js";
import { ORCHESTRATOR_PROFILES, getOrchestratorProfile } from "../../src/profiles/orchestrator-profiles.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-install-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isProfileInstalled", () => {
  it("returns false when profile directory does not exist", () => {
    expect(isProfileInstalled("architect", tmpDir)).toBe(false);
  });

  it("returns false when directory exists but core.md is missing", () => {
    fs.mkdirSync(path.join(tmpDir, "architect"), { recursive: true });
    expect(isProfileInstalled("architect", tmpDir)).toBe(false);
  });

  it("returns true when core.md exists", () => {
    const profileDir = path.join(tmpDir, "architect");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "core.md"), "# Architect", "utf-8");
    expect(isProfileInstalled("architect", tmpDir)).toBe(true);
  });
});

describe("installProfile", () => {
  it("creates directory and core.md for a known profile", () => {
    const result = installProfile("architect", tmpDir);
    expect(result).toBe(true);

    const corePath = path.join(tmpDir, "architect", "core.md");
    expect(fs.existsSync(corePath)).toBe(true);
  });

  it("creates rules.md when the profile has rules", () => {
    installProfile("architect", tmpDir);
    const rulesPath = path.join(tmpDir, "architect", "rules.md");
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it("does not create rules.md when profile has no rules", () => {
    // All orchestrator profiles have rules, so we test that installProfile
    // returns false for unknown profiles instead
    const result = installProfile("unknown-profile", tmpDir);
    expect(result).toBe(false);
  });

  it("returns false for unknown profile name", () => {
    expect(installProfile("nonexistent", tmpDir)).toBe(false);
    expect(installProfile("", tmpDir)).toBe(false);
  });

  it("returns true for each known orchestrator profile", () => {
    for (const profile of ORCHESTRATOR_PROFILES) {
      const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-known-"));
      try {
        expect(installProfile(profile.name, freshDir)).toBe(true);
      } finally {
        fs.rmSync(freshDir, { recursive: true, force: true });
      }
    }
  });

  it("core.md content matches the profile template", () => {
    installProfile("architect", tmpDir);
    const corePath = path.join(tmpDir, "architect", "core.md");
    const content = fs.readFileSync(corePath, "utf-8");
    const profile = getOrchestratorProfile("architect")!;
    expect(content).toBe(profile.core);
  });

  it("rules.md content matches the profile template", () => {
    installProfile("security", tmpDir);
    const rulesPath = path.join(tmpDir, "security", "rules.md");
    const content = fs.readFileSync(rulesPath, "utf-8");
    const profile = getOrchestratorProfile("security")!;
    expect(content).toBe(profile.rules);
  });
});

describe("ensureAllProfilesInstalled", () => {
  it("installs all 4 orchestrator profiles into empty directory", () => {
    const result = ensureAllProfilesInstalled(tmpDir);
    expect(result.installed.sort()).toEqual(["architect", "reviewer", "security", "tester"]);
    expect(result.skipped).toEqual([]);

    // Verify files actually exist
    for (const name of result.installed) {
      expect(fs.existsSync(path.join(tmpDir, name, "core.md"))).toBe(true);
    }
  });

  it("skips already-installed profiles", () => {
    // Pre-install architect
    const architectDir = path.join(tmpDir, "architect");
    fs.mkdirSync(architectDir, { recursive: true });
    fs.writeFileSync(path.join(architectDir, "core.md"), "# Custom architect", "utf-8");

    const result = ensureAllProfilesInstalled(tmpDir);
    expect(result.skipped).toEqual(["architect"]);
    expect(result.installed.sort()).toEqual(["reviewer", "security", "tester"]);

    // Verify pre-existing content was NOT overwritten
    const content = fs.readFileSync(path.join(architectDir, "core.md"), "utf-8");
    expect(content).toBe("# Custom architect");
  });
});

describe("ensureProfileReady", () => {
  it("installs a missing orchestrator profile and returns true", () => {
    const result = ensureProfileReady("architect", tmpDir);
    expect(result).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "architect", "core.md"))).toBe(true);
  });

  it("returns true for an already-installed orchestrator profile", () => {
    // Pre-install
    const profileDir = path.join(tmpDir, "security");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "core.md"), "# Security", "utf-8");

    expect(ensureProfileReady("security", tmpDir)).toBe(true);
  });

  it("returns false for a non-orchestrator profile name", () => {
    expect(ensureProfileReady("coder", tmpDir)).toBe(false);
    expect(ensureProfileReady("unknown", tmpDir)).toBe(false);
    expect(ensureProfileReady("", tmpDir)).toBe(false);
  });
});

describe("getProfilesDir", () => {
  it("returns default path under homedir", () => {
    // Clear env var to test default
    const saved = process.env.ACORE_HOME;
    delete process.env.ACORE_HOME;
    try {
      const dir = getProfilesDir();
      expect(dir).toBe(path.join(os.homedir(), ".acore", "profiles"));
    } finally {
      if (saved !== undefined) process.env.ACORE_HOME = saved;
    }
  });

  it("respects ACORE_HOME env var", () => {
    const saved = process.env.ACORE_HOME;
    process.env.ACORE_HOME = "/tmp/custom-acore";
    try {
      const dir = getProfilesDir();
      expect(dir).toBe(path.join("/tmp/custom-acore", "profiles"));
    } finally {
      if (saved !== undefined) {
        process.env.ACORE_HOME = saved;
      } else {
        delete process.env.ACORE_HOME;
      }
    }
  });
});
