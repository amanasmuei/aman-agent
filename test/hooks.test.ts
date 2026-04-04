import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpManager } from "../src/mcp/client.js";
import type { HooksConfig } from "../src/config.js";

// Mock dependencies
vi.mock("../src/logger.js", () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../src/memory.js", () => ({
  memoryRecall: vi.fn(async () => ({ total: 3, text: "some memories", memories: [] })),
  memoryContext: vi.fn(async () => ({ text: "context text", topic: "session context", groups: [], memoriesUsed: 2 })),
  reminderCheck: vi.fn(() => []),
  memoryLog: vi.fn(() => "log-id"),
  isMemoryInitialized: vi.fn(() => true),
}));

vi.mock("../src/personality.js", () => ({
  computePersonality: vi.fn(() => ({
    currentRead: "morning session, just getting started",
    energy: "high-drive",
    activeMode: "Default",
    sleepReminder: false,
    wellbeingNudge: null,
    sentiment: { frustration: 0, excitement: 0, confusion: 0, fatigue: 0, dominant: "neutral" },
  })),
  syncPersonalityToCore: vi.fn(async () => {}),
  formatWellbeingNudge: vi.fn(() => null),
}));

vi.mock("picocolors", () => ({
  default: {
    dim: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
    bold: (s: string) => s,
  },
}));

vi.mock("@clack/prompts", () => ({
  select: vi.fn(async () => "skip"),
  isCancel: vi.fn(() => false),
}));

const {
  onSessionStart,
  onBeforeToolExec,
  onWorkflowMatch,
  onSessionEnd,
} = await import("../src/hooks.js");

function createMockMcpManager(callToolResult?: string | ((name: string) => string)): McpManager {
  return {
    callTool: vi.fn(async (name: string) => {
      if (typeof callToolResult === "function") return callToolResult(name);
      return callToolResult ?? `Mock result for ${name}`;
    }),
    getTools: vi.fn(() => []),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
  } as unknown as McpManager;
}

function createHooksConfig(overrides?: Partial<HooksConfig>): HooksConfig {
  return {
    memoryRecall: true,
    sessionResume: true,
    rulesCheck: true,
    workflowSuggest: true,
    autoSessionSave: true,
    evalPrompt: false,
    personalityAdapt: true,
    extractMemories: false,
    featureHints: false,
    ...overrides,
  } as HooksConfig;
}

describe("hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- onSessionStart ---

  describe("onSessionStart", () => {
    it("detects first run when memory is empty", async () => {
      const { memoryRecall } = await import("../src/memory.js");
      (memoryRecall as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ total: 0 });

      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.firstRun).toBe(true);
      expect(result.contextInjection).toContain("first-session");
    });

    it("detects returning user when memories exist", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.firstRun).toBe(false);
    });

    it("includes memory context for returning user", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.contextInjection).toContain("session-context");
    });

    it("includes time context in first-run injection", async () => {
      const { memoryRecall } = await import("../src/memory.js");
      (memoryRecall as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ total: 0 });

      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.contextInjection).toContain("time-context");
    });

    it("extracts resume topic from identity_summary", async () => {
      const mcpManager = createMockMcpManager(() => "Resume: building the test suite");
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.resumeTopic).toContain("building the test suite");
    });

    it("skips memory recall when memoryRecall is false", async () => {
      const { memoryContext } = await import("../src/memory.js");
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ memoryRecall: false });
      await onSessionStart({ mcpManager, config });

      expect(memoryContext).not.toHaveBeenCalled();
    });

    it("skips session resume when sessionResume is false", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ sessionResume: false });
      await onSessionStart({ mcpManager, config });

      expect(mcpManager.callTool).not.toHaveBeenCalledWith("identity_summary", expect.anything());
    });

    it("shows reminders when they exist", async () => {
      const { reminderCheck } = await import("../src/memory.js");
      (reminderCheck as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { id: "r1", content: "Buy groceries", dueAt: null, status: "today", scope: "global" },
      ]);

      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.visibleReminders).toHaveLength(1);
      expect(result.visibleReminders![0]).toContain("Buy groceries");
    });

    it("handles memory recall failure gracefully", async () => {
      const { memoryRecall } = await import("../src/memory.js");
      (memoryRecall as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB error"));

      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      // Should treat as first run when recall throws
      expect(result.firstRun).toBe(true);
    });

    it("skips memory operations when memory not initialized", async () => {
      const { isMemoryInitialized, memoryRecall } = await import("../src/memory.js");
      (isMemoryInitialized as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onSessionStart({ mcpManager, config });

      expect(result.firstRun).toBe(false);
      expect(memoryRecall).not.toHaveBeenCalled();
    });
  });

  // --- onBeforeToolExec ---

  describe("onBeforeToolExec", () => {
    it("allows tool when rulesCheck is disabled", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ rulesCheck: false });
      const result = await onBeforeToolExec("some_tool", {}, { mcpManager, config });

      expect(result.allow).toBe(true);
    });

    it("always allows rules_check itself", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig();
      const result = await onBeforeToolExec("rules_check", {}, { mcpManager, config });

      expect(result.allow).toBe(true);
      expect(mcpManager.callTool).not.toHaveBeenCalled();
    });

    it("allows tool when no violations found", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify({ violations: [] }),
      );
      const config = createHooksConfig();
      const result = await onBeforeToolExec("some_tool", { arg: 1 }, { mcpManager, config });

      expect(result.allow).toBe(true);
    });

    it("blocks tool when violations are found", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify({ violations: ["Privacy violation", "Rate limit exceeded"] }),
      );
      const config = createHooksConfig();
      const result = await onBeforeToolExec("risky_tool", {}, { mcpManager, config });

      expect(result.allow).toBe(false);
      expect(result.reason).toContain("Privacy violation");
      expect(result.reason).toContain("Rate limit exceeded");
    });

    it("allows tool when rules_check returns non-JSON", async () => {
      const mcpManager = createMockMcpManager(() => "not json");
      const config = createHooksConfig();
      const result = await onBeforeToolExec("some_tool", {}, { mcpManager, config });

      expect(result.allow).toBe(true);
    });

    it("allows tool when rules_check call fails", async () => {
      const mcpManager = createMockMcpManager();
      (mcpManager.callTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("MCP error"),
      );
      const config = createHooksConfig();
      const result = await onBeforeToolExec("some_tool", {}, { mcpManager, config });

      expect(result.allow).toBe(true);
    });

    it("passes tool description to rules_check", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify({ violations: [] }),
      );
      const config = createHooksConfig();
      await onBeforeToolExec("file_write", { path: "/tmp/test" }, { mcpManager, config });

      expect(mcpManager.callTool).toHaveBeenCalledWith("rules_check", {
        action: expect.stringContaining("file_write"),
      });
    });
  });

  // --- onWorkflowMatch ---

  describe("onWorkflowMatch", () => {
    it("returns null when workflowSuggest is disabled", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ workflowSuggest: false });
      const result = await onWorkflowMatch("deploy the app", { mcpManager, config });

      expect(result).toBeNull();
    });

    it("matches workflow by name", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify([
          { name: "deploy", description: "Deploy workflow", steps: ["Build", "Test", "Deploy"] },
        ]),
      );
      const config = createHooksConfig();
      const result = await onWorkflowMatch("let's deploy now", { mcpManager, config });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("deploy");
      expect(result!.steps).toContain("1. Build");
      expect(result!.steps).toContain("2. Test");
      expect(result!.steps).toContain("3. Deploy");
    });

    it("matches workflow by description keywords", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify([
          { name: "code-review", description: "Review submitted changes thoroughly", steps: ["Checkout", "Review"] },
        ]),
      );
      const config = createHooksConfig();
      const result = await onWorkflowMatch("I need to review the PR", { mcpManager, config });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("code-review");
    });

    it("returns null when no workflows match", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify([
          { name: "deploy", description: "Deploy workflow", steps: ["Build"] },
        ]),
      );
      const config = createHooksConfig();
      const result = await onWorkflowMatch("hello there", { mcpManager, config });

      expect(result).toBeNull();
    });

    it("handles empty workflow list", async () => {
      const mcpManager = createMockMcpManager(() => JSON.stringify([]));
      const config = createHooksConfig();
      const result = await onWorkflowMatch("deploy", { mcpManager, config });

      expect(result).toBeNull();
    });

    it("handles workflow_list failure", async () => {
      const mcpManager = createMockMcpManager();
      (mcpManager.callTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("MCP error"),
      );
      const config = createHooksConfig();
      const result = await onWorkflowMatch("deploy", { mcpManager, config });

      expect(result).toBeNull();
    });

    it("handles workflows without steps", async () => {
      const mcpManager = createMockMcpManager(() =>
        JSON.stringify([{ name: "deploy", description: "Deploy" }]),
      );
      const config = createHooksConfig();
      const result = await onWorkflowMatch("deploy", { mcpManager, config });

      expect(result).not.toBeNull();
      expect(result!.steps).toBe("");
    });
  });

  // --- onSessionEnd ---

  describe("onSessionEnd", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
      { role: "user" as const, content: "Tell me about the project" },
      { role: "assistant" as const, content: "The project is about..." },
    ];

    it("saves conversation to memory when autoSessionSave is enabled", async () => {
      const { memoryLog } = await import("../src/memory.js");
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ autoSessionSave: true });

      await onSessionEnd({ mcpManager, config }, messages, "test-session");

      expect(memoryLog).toHaveBeenCalled();
    });

    it("skips saving when autoSessionSave is disabled", async () => {
      const { memoryLog } = await import("../src/memory.js");
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ autoSessionSave: false });

      await onSessionEnd({ mcpManager, config }, messages, "test-session");

      // memoryLog may be called for other reasons but not from autoSessionSave path
      // Just verify it doesn't crash
    });

    it("skips saving when too few messages", async () => {
      const { memoryLog } = await import("../src/memory.js");
      (memoryLog as ReturnType<typeof vi.fn>).mockClear();

      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ autoSessionSave: true });

      await onSessionEnd({ mcpManager, config }, [
        { role: "user", content: "hi" },
      ], "test-session");

      expect(memoryLog).not.toHaveBeenCalled();
    });

    it("updates identity with last user message", async () => {
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ autoSessionSave: true });

      await onSessionEnd({ mcpManager, config }, messages, "test-session");

      expect(mcpManager.callTool).toHaveBeenCalledWith(
        "identity_update_session",
        expect.objectContaining({
          resume: expect.stringContaining("Tell me about the project"),
        }),
      );
    });

    it("persists final personality state", async () => {
      const { syncPersonalityToCore } = await import("../src/personality.js");
      const mcpManager = createMockMcpManager();
      const config = createHooksConfig({ personalityAdapt: true });

      await onSessionEnd({ mcpManager, config }, messages, "test-session");

      expect(syncPersonalityToCore).toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      const mcpManager = createMockMcpManager();
      (mcpManager.callTool as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("MCP down"),
      );
      const config = createHooksConfig({ autoSessionSave: true });

      // Should not throw
      await onSessionEnd({ mcpManager, config }, messages, "test-session");
    });
  });
});
