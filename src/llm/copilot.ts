import OpenAI from "openai";
import { execFileSync } from "node:child_process";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
  ChatResponse,
  ChatOptions,
} from "./types.js";
import { toOpenAICompatibleMessages } from "./openai-compat.js";

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";

/**
 * Check if the `gh` CLI is installed.
 */
export function isGhCliInstalled(): boolean {
  try {
    execFileSync("which", ["gh"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the user is authenticated with `gh`.
 */
export function isGhAuthenticated(): boolean {
  try {
    const result = execFileSync("gh", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current GitHub auth token from `gh auth token`.
 */
export function getGhToken(): string {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
      .toString()
      .trim();
    if (!token) {
      throw new Error("No token returned from gh auth token");
    }
    return token;
  } catch {
    throw new Error(
      "Failed to get GitHub token. Run: gh auth login",
    );
  }
}

export function createCopilotClient(model: string): LLMClient {
  return {
    async chat(
      systemPrompt: string,
      messages: Message[],
      onChunk: (chunk: StreamChunk) => void,
      tools?: ToolDefinition[],
      options?: ChatOptions,
    ): Promise<ChatResponse> {
      // Get fresh token each call (handles token refresh)
      const token = getGhToken();
      const client = new OpenAI({
        baseURL: GITHUB_MODELS_BASE_URL,
        apiKey: token,
      });

      const openaiMessages = toOpenAICompatibleMessages(systemPrompt, messages);
      const hasTools = tools && tools.length > 0;

      try {
        let fullText = "";
        const toolCallAccumulators: Map<
          number,
          { id: string; name: string; arguments: string }
        > = new Map();

        const createParams: Record<string, unknown> = {
          model,
          max_tokens: options?.maxOutputTokens ?? 8192,
          messages: openaiMessages,
          stream: true,
        };

        if (hasTools) {
          createParams.tools = tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          }));
        }

        const stream = await client.chat.completions.create(
          createParams as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        );

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            onChunk({ type: "text", text: delta.content });
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              let acc = toolCallAccumulators.get(idx);
              if (!acc) {
                acc = { id: "", name: "", arguments: "" };
                toolCallAccumulators.set(idx, acc);
              }
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
          }
        }

        const toolUses = Array.from(toolCallAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([, acc]) => ({
            id: acc.id,
            name: acc.name,
            input: JSON.parse(acc.arguments || "{}") as Record<string, unknown>,
          }));

        onChunk({ type: "done" });

        if (toolUses.length > 0) {
          const contentBlocks = [
            ...(fullText
              ? [{ type: "text" as const, text: fullText }]
              : []),
            ...toolUses.map((tu) => ({
              type: "tool_use" as const,
              id: tu.id,
              name: tu.name,
              input: tu.input,
            })),
          ];
          return {
            message: { role: "assistant", content: contentBlocks },
            toolUses,
          };
        }

        return {
          message: { role: "assistant", content: fullText },
          toolUses: [],
        };
      } catch (error) {
        if (error instanceof OpenAI.AuthenticationError) {
          throw new Error(
            "GitHub authentication failed. Run: gh auth login",
          );
        }
        if (error instanceof OpenAI.RateLimitError) {
          throw new Error(
            "Rate limited by GitHub Models. Copilot subscribers get higher limits.",
          );
        }
        throw error;
      }
    },
  };
}
