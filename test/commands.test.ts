import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpManager } from "../src/mcp/client.js";

const tmpHome = path.join(os.tmpdir(), `aman-agent-test-cmds-${Date.now()}`);

// Point engine v1 storage roots inside tmpHome BEFORE commands.ts (and
// transitively acore-core / arules-core) is imported, so their cached
// storage singletons resolve to the test directory.
process.env.ACORE_HOME = path.join(tmpHome, ".acore");
process.env.ARULES_HOME = path.join(tmpHome, ".arules");
process.env.AMAN_HOME = path.join(tmpHome, ".aman");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

vi.mock("../src/memory.js", () => ({
  memoryContext: vi.fn(async (topic: string) => ({
    text: `Mock context for ${topic}`,
    topic,
    groups: [],
    memoriesUsed: 1,
  })),
  memoryRecall: vi.fn(async (query: string) => ({
    query,
    total: 1,
    memories: [{ content: "mock", type: "fact", score: 0.9 }],
    text: `Mock recall for ${query}`,
  })),
  memoryMultiRecall: vi.fn(async (query: string) => ({
    memories: [{ id: "1", content: `multi recall for ${query}`, type: "fact", score: 0.9 }],
    total: 1,
  })),
  isMemoryInitialized: vi.fn(() => true),
  memoryDoctor: vi.fn(async () => ({
    status: "healthy",
    issues: [],
    embeddingCoverage: 1.0,
    staleCount: 0,
    integrityOk: true,
  })),
  memoryRepair: vi.fn(async ({ dryRun }: { dryRun: boolean }) => ({
    dryRun,
    status: "ok",
    issues: [],
    actions: dryRun ? [] : ["Recovered 3 memories"],
  })),
  memoryConfig: vi.fn(async (updates?: Record<string, unknown>) => {
    if (updates) return { maxStaleDays: 60, ...updates };
    return { maxStaleDays: 30, embeddingModel: "default", autoConsolidate: true };
  }),
}));

const { handleCommand } = await import("../src/commands.js");
import { memoryDoctor, memoryRepair, memoryConfig, memoryMultiRecall } from "../src/memory.js";

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
    it("shows identity content when configured for dev:agent scope", async () => {
      const dir = path.join(tmpHome, ".acore", "dev", "agent");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "core.md"), "# My Identity", "utf-8");

      const result = await handleCommand("/identity", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Identity");
    });

    it("shows not-found message when no identity configured", async () => {
      const result = await handleCommand("/identity", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No identity configured");
    });
  });

  describe("/tools and /akit", () => {
    it("/tools aliases to /akit", async () => {
      const result = await handleCommand("/tools", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("akit");
    });

    it("shows informational stub pointing at standalone akit CLI", async () => {
      const result = await handleCommand("/akit", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Tool Management");
      expect(result.output).toContain("npx @aman_asmuei/akit");
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
    it("shows added rules from arules-core", async () => {
      await handleCommand("/rules add safety Do not harm", {});
      const result = await handleCommand("/rules", {});
      expect(result.handled).toBe(true);
      expect(result.output?.toLowerCase()).toContain("safety");
      expect(result.output).toContain("Do not harm");
    });

    it("shows not-found message when no rules configured", async () => {
      const result = await handleCommand("/rules", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No rules configured");
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
    it("calls memoryContext for recent context", async () => {
      const result = await handleCommand("/memory", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Mock context for recent context");
    });

    it("returns context output without MCP", async () => {
      const result = await handleCommand("/memory", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
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
    it("adds a rule via arules-core (no MCP needed)", async () => {
      const result = await handleCommand("/rules add safety Do not harm", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Added rule");
      expect(result.output).toContain("safety");
      expect(result.output).toContain("Do not harm");
    });

    it("shows usage message when arguments are missing", async () => {
      const result = await handleCommand("/rules add", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
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
    it("calls memoryRecall for decisions", async () => {
      const result = await handleCommand("/decisions", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Decision Log");
    });

    it("returns decision output without MCP", async () => {
      const result = await handleCommand("/decisions", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
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

  // --- /memory doctor ---

  describe("/memory doctor", () => {
    it("returns diagnostics output", async () => {
      const result = await handleCommand("/memory doctor", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("healthy");
    });

    it("shows warning icon when diagnostics finds issues", async () => {
      vi.mocked(memoryDoctor).mockResolvedValueOnce({
        status: "warning",
        issues: [{ message: "Stale entries", suggestion: "run repair" }],
      } as any);
      const result = await handleCommand("/memory doctor", {});
      expect(result.output).toContain("warning");
      expect(result.output).toContain("Stale entries");
      expect(result.output).toContain("/memory repair");
    });
  });

  // --- /memory repair ---

  describe("/memory repair", () => {
    it("dry-runs by default and shows DRY RUN label", async () => {
      const result = await handleCommand("/memory repair", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("DRY RUN");
      expect(vi.mocked(memoryRepair)).toHaveBeenCalledWith({ dryRun: true });
    });

    it("executes repair when --apply flag given", async () => {
      const result = await handleCommand("/memory repair --apply", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("Repair");
      expect(vi.mocked(memoryRepair)).toHaveBeenCalledWith({ dryRun: false });
    });
  });

  // --- /memory search ---

  describe("/memory search", () => {
    it("uses memoryMultiRecall for /memory search", async () => {
      vi.mocked(memoryMultiRecall).mockResolvedValueOnce({
        memories: [{ id: "1", content: "TypeScript preferred", type: "preference", score: 0.9, tags: [] }],
        total: 1,
      } as any);
      const result = await handleCommand("/memory search typescript", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryMultiRecall)).toHaveBeenCalledWith("typescript", expect.any(Object));
      expect(result.output).toContain("[preference]");
      expect(result.output).toContain("TypeScript preferred");
    });

    it("returns no-results message when result is empty", async () => {
      vi.mocked(memoryMultiRecall).mockResolvedValueOnce({ memories: [], total: 0 } as any);
      const result = await handleCommand("/memory search nothing here", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No memories");
    });

    it("joins multi-word query correctly", async () => {
      vi.mocked(memoryMultiRecall).mockResolvedValueOnce({
        memories: [{ id: "1", content: "TypeScript preferred", type: "preference", score: 0.9, tags: [] }],
        total: 1,
      } as any);
      const result = await handleCommand("/memory search typescript preferences", {});
      expect(vi.mocked(memoryMultiRecall)).toHaveBeenCalledWith("typescript preferences", expect.any(Object));
      expect(result.output).toContain("TypeScript preferred");
    });
  });

  // --- /memory config ---

  describe("/memory config", () => {
    it("shows current config when no args", async () => {
      const result = await handleCommand("/memory config", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("Memory Config");
    });

    it("sets a key=value when provided", async () => {
      const result = await handleCommand("/memory config maxStaleDays=60", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("maxStaleDays");
      expect(vi.mocked(memoryConfig)).toHaveBeenCalledWith({ maxStaleDays: 60 });
    });
  });
});
