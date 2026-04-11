import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMClient } from "../../src/llm/types.js";
import type { McpManager } from "../../src/mcp/client.js";

// Mock delegateTask so tests don't need real LLM/MCP infrastructure.
// Must be declared before the import below (vi.mock is hoisted).
vi.mock("../../src/delegate.js", () => ({
  delegateTask: vi.fn(),
}));

import { delegateToolHandler } from "../../src/server/tools/delegate.js";
import { delegateTask } from "../../src/delegate.js";

const mockedDelegateTask = delegateTask as unknown as ReturnType<typeof vi.fn>;

// Minimal stubs — only need to satisfy the types; the real work is
// replaced by the vi.mock above.
const stubClient = {
  chat: vi.fn(),
} as unknown as LLMClient;

const stubMcpManager = {} as unknown as McpManager;

const ctx = {
  profile: "coder",
  client: stubClient,
  mcpManager: stubMcpManager,
};

describe("delegateToolHandler", () => {
  beforeEach(() => {
    mockedDelegateTask.mockReset();
  });

  it("happy-path: maps DelegationResult to tool result and composes context prefix", async () => {
    mockedDelegateTask.mockResolvedValue({
      profile: "coder",
      task: "hello",
      response: "world",
      toolsUsed: ["git"],
      turns: 1,
      success: true,
    });

    // No context provided — task passes through unchanged.
    const plain = await delegateToolHandler(ctx, { task: "hello" });
    expect(plain).toEqual({
      ok: true,
      text: "world",
      turns: 1,
      tools_used: ["git"],
    });
    expect(mockedDelegateTask).toHaveBeenCalledWith(
      "hello",
      "coder",
      stubClient,
      stubMcpManager,
      { silent: true, hooksConfig: undefined },
    );

    // With context — composed task uses the `context\n\n---\n\ntask` shape.
    mockedDelegateTask.mockClear();
    await delegateToolHandler(ctx, { task: "hello", context: "bg info" });
    expect(mockedDelegateTask).toHaveBeenCalledWith(
      "bg info\n\n---\n\nhello",
      "coder",
      stubClient,
      stubMcpManager,
      { silent: true, hooksConfig: undefined },
    );
  });

  it("reject-empty-task: empty/whitespace task is rejected without calling delegateTask", async () => {
    const empty = await delegateToolHandler(ctx, { task: "" });
    expect(empty).toEqual({ ok: false, error: "empty task" });
    expect(mockedDelegateTask).not.toHaveBeenCalled();

    const whitespace = await delegateToolHandler(ctx, { task: "   " });
    expect(whitespace).toEqual({ ok: false, error: "empty task" });
    expect(mockedDelegateTask).not.toHaveBeenCalled();
  });

  it("reject-task-too-large: >64 KiB rejected, exactly 64 KiB accepted", async () => {
    const tooBig = await delegateToolHandler(ctx, {
      task: "x".repeat(64 * 1024 + 1),
    });
    expect(tooBig).toEqual({ ok: false, error: "task too large" });
    expect(mockedDelegateTask).not.toHaveBeenCalled();

    mockedDelegateTask.mockResolvedValue({
      profile: "coder",
      task: "ok",
      response: "done",
      toolsUsed: [],
      turns: 0,
      success: true,
    });
    const exact = await delegateToolHandler(ctx, {
      task: "x".repeat(64 * 1024),
    });
    expect(exact.ok).toBe(true);
    expect(mockedDelegateTask).toHaveBeenCalledTimes(1);
  });

  it("surface-failure: delegateTask result.success === false propagates error text", async () => {
    mockedDelegateTask.mockResolvedValue({
      profile: "coder",
      task: "do stuff",
      response: "",
      toolsUsed: [],
      turns: 0,
      success: false,
      error: "LLM went boom",
    });

    const result = await delegateToolHandler(ctx, { task: "do stuff" });
    expect(result).toEqual({ ok: false, error: "LLM went boom" });
  });
});
