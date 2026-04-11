import type { LLMClient } from "../../llm/types.js";
import type { McpManager } from "../../mcp/client.js";
import type { HooksConfig } from "../../config.js";
import { delegateTask } from "../../delegate.js";

export interface DelegateContext {
  profile: string;
  client: LLMClient;
  mcpManager: McpManager;
  hooksConfig?: HooksConfig;
}

export interface DelegateInput {
  task: string;
  context?: string;
}

export interface DelegateToolResult {
  ok: boolean;
  text?: string;
  turns?: number;
  tools_used?: string[];
  error?: string;
}

const MAX_TASK_BYTES = 64 * 1024;

/**
 * Handler for the `agent.delegate` MCP tool. Wraps the existing local
 * `delegateTask` so a remote agent can run a full delegation loop
 * (LLM + tools) through this agent's profile and return the final text.
 *
 * Task 7 registers this as the `agent.delegate` tool on the MCP server.
 */
export async function delegateToolHandler(
  ctx: DelegateContext,
  input: DelegateInput,
): Promise<DelegateToolResult> {
  if (!input.task || input.task.trim() === "") {
    return { ok: false, error: "empty task" };
  }
  if (Buffer.byteLength(input.task, "utf8") > MAX_TASK_BYTES) {
    return { ok: false, error: "task too large" };
  }

  const composed = input.context
    ? `${input.context}\n\n---\n\n${input.task}`
    : input.task;

  try {
    const result = await delegateTask(
      composed,
      ctx.profile,
      ctx.client,
      ctx.mcpManager,
      { silent: true, hooksConfig: ctx.hooksConfig },
    );
    if (!result.success) {
      return { ok: false, error: result.error ?? "delegation failed" };
    }
    return {
      ok: true,
      text: result.response,
      turns: result.turns,
      tools_used: result.toolsUsed,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
