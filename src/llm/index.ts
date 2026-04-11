import type {
  ChatOptions,
  ChatResponse,
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
} from "./types.js";
import { createAnthropicClient } from "./anthropic.js";
import { createClaudeCodeClient } from "./claude-code.js";
import { createCopilotClient } from "./copilot.js";
import { createOllamaClient } from "./ollama.js";
import { createOpenAIClient } from "./openai.js";
import type { AgentConfig } from "../config.js";

export type { LLMClient };

/**
 * Factory for constructing an LLM client from the user's config.
 *
 * When `AMAN_AGENT_FAKE_LLM=1` is set, returns a deterministic stub client
 * that echoes the last user message and never calls tools. Used exclusively
 * by the A2A integration test so it can run in a hermetic CI environment
 * without network, real API keys, or spawning aman-mcp.
 */
export function pickLLMClient(config: AgentConfig, model: string): LLMClient {
  if (process.env.AMAN_AGENT_FAKE_LLM === "1") {
    return createFakeClient();
  }
  if (config.provider === "claude-code") return createClaudeCodeClient(model);
  if (config.provider === "copilot") return createCopilotClient(model);
  if (config.provider === "anthropic")
    return createAnthropicClient(config.apiKey, model);
  if (config.provider === "ollama") return createOllamaClient(model);
  return createOpenAIClient(config.apiKey, model);
}

/**
 * Deterministic stub LLM client for the A2A integration test.
 *
 * Echoes the last user message as plain text and never emits tool calls.
 * Must satisfy `LLMClient` exactly so `serve-command.ts` compiles against
 * the real type — do not loosen.
 */
function createFakeClient(): LLMClient {
  return {
    async chat(
      _systemPrompt: string,
      messages: Message[],
      onChunk: (chunk: StreamChunk) => void,
      _tools?: ToolDefinition[],
      _options?: ChatOptions,
    ): Promise<ChatResponse> {
      const last = messages[messages.length - 1];
      const text =
        typeof last?.content === "string"
          ? last.content
          : "[fake-llm] ok";
      const reply = `[fake-llm] received: ${text}`;
      onChunk({ type: "text", text: reply });
      onChunk({ type: "done" });
      return {
        message: { role: "assistant", content: reply },
        toolUses: [],
      };
    },
  };
}
