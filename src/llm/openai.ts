import OpenAI from "openai";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
  ChatResponse,
} from "./types.js";

function toOpenAIMessages(
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
      // Assistant message with tool calls
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
      // Check if it contains tool results
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
        const text = m.content
          .map((b) => ("text" in b ? b.text : ""))
          .join("");
        result.push({ role: "user", content: text });
      }
    }
  }

  return result;
}

export function createOpenAIClient(apiKey: string, model: string): LLMClient {
  const client = new OpenAI({ apiKey });

  return {
    async chat(
      systemPrompt: string,
      messages: Message[],
      onChunk: (chunk: StreamChunk) => void,
      tools?: ToolDefinition[],
    ): Promise<ChatResponse> {
      const openaiMessages = toOpenAIMessages(systemPrompt, messages);
      const hasTools = tools && tools.length > 0;

      try {
        if (hasTools) {
          // Non-streaming with tools
          const response = await client.chat.completions.create({
            model,
            max_tokens: 8192,
            messages: openaiMessages,
            tools: tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            })),
          });

          const choice = response.choices[0];
          const textContent = choice?.message?.content || "";
          const toolCalls = choice?.message?.tool_calls || [];

          const toolUses = toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || "{}") as Record<
              string,
              unknown
            >,
          }));

          if (textContent && toolUses.length === 0) {
            onChunk({ type: "text", text: textContent });
            onChunk({ type: "done" });
          } else if (textContent) {
            onChunk({ type: "text", text: textContent });
          }

          // Build content blocks
          if (toolUses.length > 0) {
            const contentBlocks = [
              ...(textContent
                ? [{ type: "text" as const, text: textContent }]
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
            message: { role: "assistant", content: textContent },
            toolUses: [],
          };
        } else {
          // Streaming without tools — original behavior
          let fullText = "";

          const stream = await client.chat.completions.create({
            model,
            max_tokens: 8192,
            messages: openaiMessages,
            stream: true,
          });

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || "";
            if (text) {
              fullText += text;
              onChunk({ type: "text", text });
            }
          }

          onChunk({ type: "done" });
          return {
            message: { role: "assistant", content: fullText },
            toolUses: [],
          };
        }
      } catch (error) {
        if (error instanceof OpenAI.AuthenticationError) {
          throw new Error(
            "Invalid API key. Run with --model flag or delete ~/.aman-agent/config.json to reconfigure.",
          );
        }
        if (error instanceof OpenAI.RateLimitError) {
          throw new Error("Rate limited by OpenAI. Please wait and retry.");
        }
        throw error;
      }
    },
  };
}
