import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpManager } from "../src/mcp/client.js";

const tmpHome = path.join(os.tmpdir(), `aman-agent-test-cmds-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const { handleCommand } = await import("../src/commands.js");

function createMockMcpManager() {
  return {
    callTool: vi.fn(async (name: string) => `Mock result for ${name}`),
    getTools: vi.fn(() => []),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  } as unknown as McpManager;
}

describe("handleCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // --- Quit commands ---

  describe("/quit, /exit, /q", () => {
    it("/quit sets quit flag", async () => {
      const result = await handleCommand("/quit", {});
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });

    it("/exit sets quit flag", async () => {
      const result = await handleCommand("/exit", {});
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });

    it("/q sets quit flag", async () => {
      const result = await handleCommand("/q", {});
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });
  });

  // --- Help ---

  describe("/help", () => {
    it("returns help output listing commands", async () => {
      const result = await handleCommand("/help", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("/help");
      expect(result.output).toContain("/quit");
      expect(result.output).toContain("/identity");
      expect(result.output).toContain("/akit");
      expect(result.output).toContain("/workflows");
      expect(result.output).toContain("/rules");
      expect(result.output).toContain("/skills");
      expect(result.output).toContain("/model");
      expect(result.output).toContain("/clear");
    });
  });

  // --- Clear ---

  describe("/clear", () => {
    it("sets clearHistory flag", async () => {
      const result = await handleCommand("/clear", {});
      expect(result.handled).toBe(true);
      expect(result.clearHistory).toBe(true);
      expect(result.output).toContain("cleared");
    });
  });

  // --- Model ---

  describe("/model", () => {
    it("shows provided model name", async () => {
      const result = await handleCommand("/model", { model: "claude-sonnet-4-20250514" });
      expect(result.handled).toBe(true);
      expect(result.output).toContain("claude-sonnet-4-20250514");
    });

    it("shows unknown when no model provided", async () => {
      const result = await handleCommand("/model", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("unknown");
    });
  });

  // --- Ecosystem file commands ---

  describe("/identity", () => {
    it("shows core.md content when file exists", async () => {
      const dir = path.join(tmpHome, ".acore");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "core.md"), "# My Identity", "utf-8");

      const result = await handleCommand("/identity", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Identity");
    });

    it("shows not-found message when file is missing", async () => {
      const result = await handleCommand("/identity", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("identity");
    });
  });

  describe("/tools and /akit", () => {
    it("shows installed tools when some exist", async () => {
      const dir = path.join(tmpHome, ".akit");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "installed.json"), JSON.stringify([
        { name: "github", installedAt: "2026-03-26", mcpConfigured: true },
      ]), "utf-8");

      const result = await handleCommand("/akit", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("github");
      expect(result.output).toContain("MCP");
    });

    it("/tools aliases to /akit", async () => {
      const result = await handleCommand("/tools", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("akit");
    });

    it("shows available tools when none installed", async () => {
      const result = await handleCommand("/akit", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Available");
      expect(result.output).toContain("akit add");
    });
  });

  describe("/workflows", () => {
    it("shows flow.md content when file exists", async () => {
      const dir = path.join(tmpHome, ".aflow");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "flow.md"), "# My Workflows", "utf-8");

      const result = await handleCommand("/workflows", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Workflows");
    });

    it("shows not-found message when file is missing", async () => {
      const result = await handleCommand("/workflows", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("workflows");
    });
  });

  describe("/rules", () => {
    it("shows rules.md content when file exists", async () => {
      const dir = path.join(tmpHome, ".arules");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "rules.md"), "# My Rules", "utf-8");

      const result = await handleCommand("/rules", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Rules");
    });

    it("shows not-found message when file is missing", async () => {
      const result = await handleCommand("/rules", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("guardrails");
    });
  });

  describe("/skills", () => {
    it("shows skills.md content when file exists", async () => {
      const dir = path.join(tmpHome, ".askill");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skills.md"), "# My Skills", "utf-8");

      const result = await handleCommand("/skills", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Skills");
    });

    it("shows not-found message when file is missing", async () => {
      const result = await handleCommand("/skills", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("skills");
    });
  });

  // --- Unknown commands ---

  describe("unknown commands", () => {
    it("passes unknown slash commands to LLM (not treated as commands)", async () => {
      const result = await handleCommand("/foobar", {});
      expect(result.handled).toBe(false);
    });

    it("passes file paths to LLM (not treated as commands)", async () => {
      const result = await handleCommand("/Users/someone/file.txt", {});
      expect(result.handled).toBe(false);
    });
  });

  // --- Non-commands ---

  describe("non-commands (regular input)", () => {
    it("returns handled: false for regular text", async () => {
      const result = await handleCommand("hello world", {});
      expect(result.handled).toBe(false);
      expect(result.output).toBeUndefined();
    });

    it("returns handled: false for empty string", async () => {
      const result = await handleCommand("", {});
      expect(result.handled).toBe(false);
    });
  });

  // --- Case insensitivity ---

  describe("case insensitivity", () => {
    it("handles uppercase /HELP", async () => {
      const result = await handleCommand("/HELP", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("/help");
    });

    it("handles mixed case /QuIt", async () => {
      const result = await handleCommand("/QuIt", {});
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });
  });

  // --- Whitespace handling ---

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", async () => {
      const result = await handleCommand("  /help  ", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("/help");
    });
  });

  // --- /eval ---

  describe("/eval", () => {
    it("reads eval.md content when file exists", async () => {
      const dir = path.join(tmpHome, ".aeval");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "eval.md"), "# My Eval", "utf-8");

      const result = await handleCommand("/eval", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Eval");
    });

    it("shows not-found message when eval.md is missing", async () => {
      const result = await handleCommand("/eval", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
    });
  });

  // --- /memory ---

  describe("/memory", () => {
    it("calls memory_context via MCP when connected", async () => {
      const mcp = createMockMcpManager();
      const result = await handleCommand("/memory", { mcpManager: mcp });
      expect(result.handled).toBe(true);
      expect(mcp.callTool).toHaveBeenCalledWith("memory_context", {});
      expect(result.output).toContain("Mock result for memory_context");
    });

    it("shows error when MCP not connected", async () => {
      const result = await handleCommand("/memory", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("not connected");
    });
  });

  // --- /status ---

  describe("/status", () => {
    it("returns handled: true with output", async () => {
      const result = await handleCommand("/status", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
    });
  });

  // --- /doctor ---

  describe("/doctor", () => {
    it("returns handled: true with output", async () => {
      const result = await handleCommand("/doctor", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
    });
  });

  // --- /rules add (write subcommand) ---

  describe("/rules add", () => {
    it("delegates to MCP when mcpManager is provided", async () => {
      const mcp = createMockMcpManager();
      const result = await handleCommand("/rules add safety Do not harm", { mcpManager: mcp });
      expect(result.handled).toBe(true);
      expect(mcp.callTool).toHaveBeenCalledWith("rules_add", { category: "safety", rule: "Do not harm" });
    });

    it("shows not connected error without mcpManager", async () => {
      const result = await handleCommand("/rules add safety Do not harm", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("not connected");
    });
  });

  // --- /skills install ---

  describe("/skills install", () => {
    it("delegates to MCP when mcpManager is provided", async () => {
      const mcp = createMockMcpManager();
      const result = await handleCommand("/skills install code-review", { mcpManager: mcp });
      expect(result.handled).toBe(true);
      expect(mcp.callTool).toHaveBeenCalledWith("skill_install", { name: "code-review" });
    });
  });

  // --- /eval milestone ---

  describe("/eval milestone", () => {
    it("delegates to MCP with eval_milestone", async () => {
      const mcp = createMockMcpManager();
      const result = await handleCommand("/eval milestone Completed phase 1", { mcpManager: mcp });
      expect(result.handled).toBe(true);
      expect(mcp.callTool).toHaveBeenCalledWith("eval_milestone", { text: "Completed phase 1" });
    });
  });

  // --- /decisions ---

  describe("/decisions", () => {
    it("delegates to MCP memory_recall for decisions", async () => {
      const mcp = createMockMcpManager();
      const result = await handleCommand("/decisions", { mcpManager: mcp });
      expect(result.handled).toBe(true);
      expect(mcp.callTool).toHaveBeenCalled();
    });

    it("shows error when MCP not connected", async () => {
      const result = await handleCommand("/decisions", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("not connected");
    });
  });

  // --- /export ---

  describe("/export", () => {
    it("sets exportConversation flag", async () => {
      const result = await handleCommand("/export", {});
      expect(result.handled).toBe(true);
      expect(result.exportConversation).toBe(true);
    });
  });

  // --- /debug ---

  describe("/debug", () => {
    it("returns handled: true", async () => {
      const result = await handleCommand("/debug", {});
      expect(result.handled).toBe(true);
    });
  });
});
