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
const { loadConfig, saveConfig, configExists } = await import("../src/config.js");

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
});
