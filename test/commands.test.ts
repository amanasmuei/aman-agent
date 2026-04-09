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

vi.mock("../src/files.js", () => ({
  readFile: vi.fn(async (p: string) => ({
    path: p,
    content: "file content here",
    size: 17,
    truncated: false,
    encoding: "utf-8" as const,
  })),
  listFiles: vi.fn(async (p: string) => ({
    path: p,
    entries: [
      { name: "foo.ts", type: "file" as const, size: 1234 },
      { name: "bar", type: "dir" as const, size: 0 },
    ],
    total: 2,
  })),
}));

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
  memoryReflect: vi.fn(async () => ({
    clusters: [],
    contradictions: [],
    synthesisCandidates: [],
    knowledgeGaps: [],
    orphans: 0,
    stats: { totalMemories: 5, clusteredMemories: 0, totalClusters: 0, avgClusterSize: 0, contradictionsFound: 0, synthesisCandidates: 0, knowledgeGaps: 0, healthScore: 1 },
    timestamp: Date.now(),
    durationMs: 100,
  })),
  memoryConsolidate: vi.fn(() => ({ merged: 2, pruned: 1, promoted: 0, decayed: 0, actions: [], healthScore: 0.9, before: { total: 10 }, after: { total: 9 } })),
  memoryTier: vi.fn(() => ({ id: "mem-001", tier: "core", ok: true as const })),
  memoryDetail: vi.fn(() => ({ id: "mem-001", content: "Test memory", type: "fact", confidence: 0.9, scope: "global", tags: [], createdAt: 1000, accessCount: 3, tier: "working" })),
  memoryRelate: vi.fn(() => ({ ok: true as const, relationId: "rel-123" })),
  memoryExpire: vi.fn(() => ({ ok: true as const, id: "mem-001" })),
  memoryVersions: vi.fn(() => [{ versionId: "v1", memoryId: "mem-001", content: "Old content", confidence: 0.8, editedAt: 1000, reason: "patch" }]),
  memorySync: vi.fn(async () => ({ imported: 3, skipped: 0, updated: 0, details: [], projectsScanned: 1 })),
}));

const { handleCommand } = await import("../src/commands.js");
import { memoryDoctor, memoryRepair, memoryConfig, memoryMultiRecall, memoryReflect, memoryConsolidate, memoryTier, memoryDetail, memoryRelate, memoryExpire, memoryVersions, memorySync } from "../src/memory.js";
import { readFile, listFiles } from "../src/files.js";

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
      const result = await handleCommand("/memory config consolidation.maxStaleDays=60", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("consolidation.maxStaleDays");
      expect(vi.mocked(memoryConfig)).toHaveBeenCalledWith({ consolidation: { maxStaleDays: 60 } });
    });
  });

  // --- /file ---

  describe("/file read", () => {
    it("reads a file and shows content", async () => {
      const result = await handleCommand("/file read /tmp/hello.txt", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(readFile)).toHaveBeenCalledWith("/tmp/hello.txt");
      expect(result.output).toContain("file content here");
    });

    it("returns usage when no path given", async () => {
      const result = await handleCommand("/file read", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  describe("/file list", () => {
    it("lists directory contents", async () => {
      const result = await handleCommand("/file list /tmp", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(listFiles)).toHaveBeenCalledWith("/tmp", { recursive: false });
      expect(result.output).toContain("foo.ts");
    });

    it("passes recursive=true when --recursive flag given", async () => {
      await handleCommand("/file list /tmp --recursive", {});
      expect(vi.mocked(listFiles)).toHaveBeenCalledWith("/tmp", { recursive: true });
    });

    it("returns usage when no path given", async () => {
      const result = await handleCommand("/file list", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  describe("/file convert", () => {
    it("reads file content via readFile", async () => {
      const result = await handleCommand("/file convert /tmp/doc.txt", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(readFile)).toHaveBeenCalledWith("/tmp/doc.txt");
      expect(result.output).toContain("file content here");
    });

    it("returns error message when readFile throws", async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error("binary file not supported"));
      const result = await handleCommand("/file convert /tmp/doc.pdf", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("error");
    });

    it("returns usage when no path given", async () => {
      const result = await handleCommand("/file convert", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  describe("/file", () => {
    it("shows help when no subcommand given", async () => {
      const result = await handleCommand("/file", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("read");
      expect(result.output).toContain("convert");
      expect(result.output).toContain("list");
    });
  });

  describe("/memory reflect", () => {
    it("runs reflection and returns summary output", async () => {
      const result = await handleCommand("/memory reflect", {});
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(vi.mocked(memoryReflect)).toHaveBeenCalledOnce();
    });
  });

  describe("/memory consolidate", () => {
    it("runs consolidation in dry-run mode by default", async () => {
      const result = await handleCommand("/memory consolidate", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryConsolidate)).toHaveBeenCalledWith(true);
    });

    it("applies changes when --apply is given", async () => {
      await handleCommand("/memory consolidate --apply", {});
      expect(vi.mocked(memoryConsolidate)).toHaveBeenCalledWith(false);
    });
  });

  describe("/memory tier", () => {
    it("sets the tier for a memory", async () => {
      const result = await handleCommand("/memory tier mem-001 core", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryTier)).toHaveBeenCalledWith("mem-001", "core");
    });

    it("returns usage when no id given", async () => {
      const result = await handleCommand("/memory tier", {});
      expect(result.output).toContain("Usage");
    });
  });

  describe("/memory detail", () => {
    it("returns full memory detail", async () => {
      const result = await handleCommand("/memory detail mem-001", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryDetail)).toHaveBeenCalledWith("mem-001");
      expect(result.output).toContain("mem-001");
    });

    it("returns not-found message when detail returns null", async () => {
      vi.mocked(memoryDetail).mockReturnValueOnce(null);
      const result = await handleCommand("/memory detail mem-999", {});
      expect(result.output).toMatch(/not found/i);
    });
  });

  describe("/memory relate", () => {
    it("creates a relation between two memories", async () => {
      const result = await handleCommand("/memory relate mem-001 mem-002 supports", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryRelate)).toHaveBeenCalledWith("mem-001", "mem-002", "supports", undefined);
    });

    it("returns usage when fewer than 3 args given", async () => {
      const result = await handleCommand("/memory relate mem-001", {});
      expect(result.output).toContain("Usage");
    });
  });

  describe("/memory expire", () => {
    it("expires a memory by id", async () => {
      const result = await handleCommand("/memory expire mem-001", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryExpire)).toHaveBeenCalledWith("mem-001", undefined);
    });

    it("passes optional reason through", async () => {
      await handleCommand("/memory expire mem-001 outdated info", {});
      expect(vi.mocked(memoryExpire)).toHaveBeenCalledWith("mem-001", "outdated info");
    });
  });

  describe("/memory versions", () => {
    it("returns version history for a memory", async () => {
      const result = await handleCommand("/memory versions mem-001", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memoryVersions)).toHaveBeenCalledWith("mem-001");
    });

    it("returns usage when no id given", async () => {
      const result = await handleCommand("/memory versions", {});
      expect(result.output).toContain("Usage");
    });
  });

  describe("/memory sync", () => {
    it("calls memorySync with the given action", async () => {
      const result = await handleCommand("/memory sync import-claude", {});
      expect(result.handled).toBe(true);
      expect(vi.mocked(memorySync)).toHaveBeenCalledWith("import-claude", expect.any(Object));
    });

    it("returns usage when no action given", async () => {
      const result = await handleCommand("/memory sync", {});
      expect(result.output).toContain("Usage");
    });
  });

  // --- /identity dynamics ---

  describe("/identity dynamics", () => {
    it("updates dynamics fields when key=value pairs are provided", async () => {
      const dir = path.join(tmpHome, ".acore", "dev", "agent");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "core.md"),
        "# Identity\n\n## Dynamics\n- Baseline energy: steady\n- Active mode: Default\n- Current read: none\n",
        "utf-8",
      );
      const result = await handleCommand("/identity dynamics energy=high mode=focused", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Dynamics updated");
      expect(result.output).toContain("energy=high");
      expect(result.output).toContain("mode=focused");
    });

    it("returns usage when no key=value pairs given", async () => {
      const result = await handleCommand("/identity dynamics", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  // --- /identity summary ---

  describe("/identity summary", () => {
    it("returns structured summary when identity is configured", async () => {
      const dir = path.join(tmpHome, ".acore", "dev", "agent");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "core.md"),
        "# Identity\n\n**Name:** Aman\n\n## Personality\nCurious and direct.\n",
        "utf-8",
      );
      const result = await handleCommand("/identity summary", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Identity Summary");
      expect(result.output).toContain("Aman");
      expect(result.output).toContain("dev:agent");
    });

    it("shows no-identity message when none is configured", async () => {
      const result = await handleCommand("/identity summary", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No identity configured");
    });
  });

  // --- /rules check ---

  describe("/rules check", () => {
    it("reports safe when no rules are configured", async () => {
      const result = await handleCommand("/rules check send a friendly email", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("allowed");
    });

    it("returns usage when no description given", async () => {
      const result = await handleCommand("/rules check", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  // --- /skills search ---

  describe("/skills search", () => {
    it("returns matching skills from skills.md", async () => {
      const dir = path.join(tmpHome, ".askill");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "skills.md"),
        "# Skills\n\n- code-review: Review pull requests\n- testing: Run test suites\n",
        "utf-8",
      );
      const result = await handleCommand("/skills search review", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("code-review");
      expect(result.output).not.toContain("testing");
    });

    it("shows no-results message when query has no matches", async () => {
      const dir = path.join(tmpHome, ".askill");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skills.md"), "# Skills\n\n- alpha: something\n", "utf-8");
      const result = await handleCommand("/skills search zzz-nonexistent", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No skills matching");
    });

    it("returns usage when no query given", async () => {
      const result = await handleCommand("/skills search", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  // --- /tools search ---

  describe("/tools search", () => {
    it("returns matches from tools.md when file exists", async () => {
      const dir = path.join(tmpHome, ".akit");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "tools.md"),
        "# Tools\n\n- ripgrep: Fast text search\n- jq: JSON processor\n",
        "utf-8",
      );
      const result = await handleCommand("/tools search ripgrep", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("ripgrep");
      expect(result.output).not.toContain("jq");
    });

    it("prompts user to use akit CLI when tools.md not found", async () => {
      const result = await handleCommand("/tools search ripgrep", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("akit");
    });

    it("returns usage when no query given", async () => {
      const result = await handleCommand("/tools search", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  // --- /workflows get ---

  describe("/workflows get", () => {
    it("returns a named workflow section from flow.md", async () => {
      const dir = path.join(tmpHome, ".aflow");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "flow.md"),
        "# Workflows\n\n## deploy\n1. Run tests\n2. Push to main\n\n## review\n1. Check PR\n",
        "utf-8",
      );
      const result = await handleCommand("/workflows get deploy", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("deploy");
      expect(result.output).toContain("Run tests");
    });

    it("shows not-found when workflow name does not match", async () => {
      const dir = path.join(tmpHome, ".aflow");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "flow.md"), "# Workflows\n\n## deploy\n1. Step\n", "utf-8");
      const result = await handleCommand("/workflows get nonexistent", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No workflow found");
    });

    it("returns usage when no name given", async () => {
      const result = await handleCommand("/workflows get", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Usage");
    });
  });

  // --- /eval report ---

  describe("/eval report", () => {
    it("returns the full eval report when eval.md exists", async () => {
      const dir = path.join(tmpHome, ".aeval");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "eval.md"),
        "# Eval\n\n## Milestone 1\nShipped phase 1.\n",
        "utf-8",
      );
      const result = await handleCommand("/eval report", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Eval Report");
      expect(result.output).toContain("Shipped phase 1");
    });

    it("shows no-report message when eval.md is missing", async () => {
      const result = await handleCommand("/eval report", {});
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No eval report");
    });
  });
});
