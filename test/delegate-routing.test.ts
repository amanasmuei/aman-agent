import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/delegate-remote.js", () => ({
  delegateRemote: vi.fn(),
}));

vi.mock("../src/prompt.js", () => ({
  assembleSystemPrompt: vi.fn(() => ({ prompt: "stub system prompt" })),
}));

vi.mock("../src/memory.js", () => ({
  memoryRecall: vi.fn(async () => ({ total: 0, text: "" })),
}));

import { delegateTask } from "../src/delegate.js";
import { delegateRemote } from "../src/delegate-remote.js";
import type { LLMClient } from "../src/llm/types.js";
import type { McpManager } from "../src/mcp/client.js";

const mockDelegateRemote = vi.mocked(delegateRemote);

describe("delegateTask routing", () => {
  beforeEach(() => {
    mockDelegateRemote.mockReset();
  });

  it("routes @name profiles to delegateRemote", async () => {
    mockDelegateRemote.mockResolvedValue({
      profile: "@coder",
      task: "hello",
      response: "remote reply",
      toolsUsed: [],
      turns: 0,
      success: true,
    });

    const result = await delegateTask(
      "hello",
      "@coder",
      null as unknown as LLMClient,
      null as unknown as McpManager,
    );

    expect(mockDelegateRemote).toHaveBeenCalledOnce();
    expect(mockDelegateRemote).toHaveBeenCalledWith("hello", "coder", {});
    expect(result.success).toBe(true);
    expect(result.response).toBe("remote reply");
    expect(result.profile).toBe("@coder");
  });

  it("empty remote name (just '@') returns an error without dialing", async () => {
    const result = await delegateTask(
      "hello",
      "@",
      null as unknown as LLMClient,
      null as unknown as McpManager,
    );

    expect(mockDelegateRemote).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe("empty remote agent name");
    expect(result.profile).toBe("@");
    expect(result.task).toBe("hello");
    expect(result.response).toBe("");
  });

  it("bare profile name (no @) runs local delegation, not remote", async () => {
    // Stub LLMClient that returns zero tool calls so the loop exits after 1 turn.
    const client = {
      async chat() {
        return {
          message: { role: "assistant", content: "local reply" },
          toolUses: [],
        };
      },
    } as unknown as LLMClient;

    // Stub McpManager — delegateTask accesses callTool but won't call it
    // if toolUses is empty. We still need it to exist for the type.
    const mgr = { callTool: vi.fn() } as unknown as McpManager;

    const result = await delegateTask("hello", "coder", client, mgr);

    expect(mockDelegateRemote).not.toHaveBeenCalled();
    // Local path sets profile to the literal string passed in
    expect(result.profile).toBe("coder");
    expect(result.success).toBe(true);
    expect(result.response).toContain("local reply");
  });
});
