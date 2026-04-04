import OpenAI from "openai";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
  ChatResponse,
  ChatOptions,
} from "./types.js";
import { toOpenAICompatibleMessages } from "./openai-compat.js";

export function createOllamaClient(
  model: string,
  baseURL?: string,
): LLMClient {
  const client = new OpenAI({
    baseURL: baseURL || "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama doesn't require a real key
  });

  return {
    async chat(
      systemPrompt: string,
      messages: Message[],
      onChunk: (chunk: StreamChunk) => void,
      tools?: ToolDefinition[],
      options?: ChatOptions,
    ): Promise<ChatResponse> {
      const ollamaMessages = toOpenAICompatibleMessages(systemPrompt, messages);
      const hasTools = tools && tools.length > 0;

      try {
        let fullText = "";
        const toolCallAccumulators: Map<
          number,
          { id: string; name: string; arguments: string }
        > = new Map();

        const createParams: Record<string, unknown> = {
          model,
          max_tokens: options?.maxOutputTokens ?? 4096,
          messages: ollamaMessages,
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

          // Stream text content
          if (delta.content) {
            fullText += delta.content;
            onChunk({ type: "text", text: delta.content });
          }

          // Accumulate tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              let acc = toolCallAccumulators.get(idx);
              if (!acc) {
                acc = { id: "", name: "", arguments: "" };
                toolCallAccumulators.set(idx, acc);
              }
              if (tc.id) {
                acc.id = tc.id;
              }
              if (tc.function?.name) {
                acc.name = tc.function.name;
              }
              if (tc.function?.arguments) {
                acc.arguments += tc.function.arguments;
              }
            }
          }
        }

        // Parse accumulated tool calls
        const toolUses = Array.from(toolCallAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([, acc]) => ({
            id: acc.id,
            name: acc.name,
            input: JSON.parse(acc.arguments || "{}") as Record<
              string,
              unknown
            >,
          }));

        // Signal done
        onChunk({ type: "done" });

        // Build response
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
        if (
          error instanceof Error &&
          error.message.includes("ECONNREFUSED")
        ) {
          throw new Error(
            "Cannot connect to Ollama. Make sure it's running: ollama serve",
          );
        }
        throw error;
      }
    },
  };
}
