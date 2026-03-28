import OpenAI from "openai";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
  ChatResponse,
} from "./types.js";

function toOllamaMessages(
  systemPrompt: string,
  messages: Message[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const m of messages) {
    if (typeof m.content === "string") {
      result.push({
        role: m.role as "user" | "assistant",
        content: m.content,
      });
    } else if (m.role === "assistant") {
      const textParts = m.content.filter((b) => b.type === "text");
      const toolUseParts = m.content.filter((b) => b.type === "tool_use");
      const text = textParts.map((b) => ("text" in b ? b.text : "")).join("");

      if (toolUseParts.length > 0) {
        result.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUseParts.map((b) => ({
            id: "id" in b ? b.id : "",
            type: "function" as const,
            function: {
              name: "name" in b ? b.name : "",
              arguments: JSON.stringify("input" in b ? b.input : {}),
            },
          })),
        });
      } else {
        result.push({ role: "assistant", content: text });
      }
    } else if (m.role === "user") {
      const toolResults = m.content.filter((b) => b.type === "tool_result");
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          if (tr.type === "tool_result") {
            result.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            });
          }
        }
      } else {
        // User message — may contain text + images
        const hasImages = m.content.some((b) => b.type === "image");
        if (hasImages) {
          const parts: Array<Record<string, unknown>> = [];
          for (const b of m.content) {
            if (b.type === "text") {
              parts.push({ type: "text", text: b.text });
            } else if (b.type === "image") {
              parts.push({
                type: "image_url",
                image_url: {
                  url: `data:${b.source.media_type};base64,${b.source.data}`,
                },
              });
            }
          }
          result.push({ role: "user", content: parts as never });
        } else {
          const text = m.content
            .map((b) => ("text" in b ? b.text : ""))
            .join("");
          result.push({ role: "user", content: text });
        }
      }
    }
  }

  return result;
}

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
    ): Promise<ChatResponse> {
      const ollamaMessages = toOllamaMessages(systemPrompt, messages);
      const hasTools = tools && tools.length > 0;

      try {
        let fullText = "";
        const toolCallAccumulators: Map<
          number,
          { id: string; name: string; arguments: string }
        > = new Map();

        const createParams: Record<string, unknown> = {
          model,
          max_tokens: 8192,
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
