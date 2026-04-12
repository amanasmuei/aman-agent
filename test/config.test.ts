import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock os.homedir to use a temp directory
const tmpHome = path.join(os.tmpdir(), `aman-agent-test-config-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

// Import after mocking
const { loadConfig, saveConfig, configExists, homeDir, identityDir, rulesDir, memoryDir, workflowsDir, skillsDir, evalDir } = await import("../src/config.js");
import type { HooksConfig } from "../src/config.js";

const CONFIG_DIR = path.join(tmpHome, ".aman-agent");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

describe("config", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    it("returns null when config file does not exist", () => {
      expect(loadConfig()).toBeNull();
    });

    it("returns parsed config from a valid JSON file", () => {
      const config = {
        provider: "anthropic",
        apiKey: "sk-test-123",
        model: "claude-sonnet-4-20250514",
      };
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config), "utf-8");

      const result = loadConfig();
      expect(result).toEqual({
        ...config,
        hooks: {
          memoryRecall: true,
          sessionResume: true,
          rulesCheck: true,
          workflowSuggest: true,
          evalPrompt: true,
          autoSessionSave: true,
          extractMemories: true,
          featureHints: true,
          personalityAdapt: true,
        },
      });
    });

    it("returns null for malformed JSON", () => {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, "{ not valid json !!!", "utf-8");

      expect(loadConfig()).toBeNull();
    });
  });

  describe("saveConfig", () => {
    it("creates the config directory and writes the file", () => {
      const config = {
        provider: "openai" as const,
        apiKey: "sk-openai-456",
        model: "gpt-4o",
      };

      saveConfig(config);

      expect(fs.existsSync(CONFIG_PATH)).toBe(true);
      const contents = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(contents).toEqual(config);
    });

    it("overwrites an existing config file", () => {
      const first = {
        provider: "anthropic" as const,
        apiKey: "sk-1",
        model: "claude-sonnet-4-20250514",
      };
      const second = {
        provider: "openai" as const,
        apiKey: "sk-2",
        model: "gpt-4o",
      };

      saveConfig(first);
      saveConfig(second);

      const contents = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      expect(contents).toEqual(second);
    });
  });

  describe("configExists", () => {
    it("returns false when no config file exists", () => {
      expect(configExists()).toBe(false);
    });

    it("returns true when config file exists", () => {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, "{}", "utf-8");

      expect(configExists()).toBe(true);
    });
  });

  describe("homeDir and subdirectory resolvers", () => {
    it("defaults to ~/.aman-agent", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(homeDir()).toBe(path.join(tmpHome, ".aman-agent"));
    });

    it("respects AMAN_HOME env var", () => {
      const custom = path.join(tmpHome, "custom-home");
      process.env.AMAN_HOME = custom;
      try {
        expect(homeDir()).toBe(custom);
      } finally {
        delete process.env.AMAN_HOME;
      }
    });

    it("AMAN_HOME takes priority over AMAN_AGENT_HOME", () => {
      const amanHome = path.join(tmpHome, "aman-home");
      const agentHome = path.join(tmpHome, "agent-home");
      process.env.AMAN_HOME = amanHome;
      process.env.AMAN_AGENT_HOME = agentHome;
      try {
        expect(homeDir()).toBe(amanHome);
      } finally {
        delete process.env.AMAN_HOME;
        delete process.env.AMAN_AGENT_HOME;
      }
    });

    it("identityDir returns homeDir()/identity", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(identityDir()).toBe(path.join(tmpHome, ".aman-agent", "identity"));
    });

    it("rulesDir returns homeDir()/rules", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(rulesDir()).toBe(path.join(tmpHome, ".aman-agent", "rules"));
    });

    it("memoryDir returns homeDir()/memory", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(memoryDir()).toBe(path.join(tmpHome, ".aman-agent", "memory"));
    });

    it("workflowsDir returns homeDir()/workflows", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(workflowsDir()).toBe(path.join(tmpHome, ".aman-agent", "workflows"));
    });

    it("skillsDir returns homeDir()/skills", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(skillsDir()).toBe(path.join(tmpHome, ".aman-agent", "skills"));
    });

    it("evalDir returns homeDir()/eval", () => {
      delete process.env.AMAN_HOME;
      delete process.env.AMAN_AGENT_HOME;
      expect(evalDir()).toBe(path.join(tmpHome, ".aman-agent", "eval"));
    });
  });

  describe("orchestrator config", () => {
    it("loads orchestrator settings from config.json", () => {
      const config = {
        provider: "anthropic",
        apiKey: "sk-test-123",
        model: "claude-sonnet-4-20250514",
        orchestrator: {
          maxParallelTasks: 4,
          defaultTier: "standard",
          requireApprovalForPhaseTransition: true,
          taskTimeoutMs: 30000,
          orchestrationTimeoutMs: 120000,
        },
      };
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config), "utf-8");

      const result = loadConfig();
      expect(result).not.toBeNull();
      expect(result!.orchestrator).toEqual({
        maxParallelTasks: 4,
        defaultTier: "standard",
        requireApprovalForPhaseTransition: true,
        taskTimeoutMs: 30000,
        orchestrationTimeoutMs: 120000,
      });
    });

    it("works without orchestrator settings (backward compat)", () => {
      const config = {
        provider: "anthropic",
        apiKey: "sk-test-123",
        model: "claude-sonnet-4-20250514",
      };
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config), "utf-8");

      const result = loadConfig();
      expect(result).not.toBeNull();
      expect(result!.orchestrator).toBeUndefined();
    });
  });

  describe("HooksConfig observation fields", () => {
    it("accepts recordObservations and autoPostmortem flags", () => {
      const config: HooksConfig = {
        recordObservations: true,
        autoPostmortem: true,
      };
      expect(config.recordObservations).toBe(true);
      expect(config.autoPostmortem).toBe(true);
    });

    it("defaults are undefined (treated as true by hooks)", () => {
      const config: HooksConfig = {};
      expect(config.recordObservations).toBeUndefined();
      expect(config.autoPostmortem).toBeUndefined();
    });
  });
});
