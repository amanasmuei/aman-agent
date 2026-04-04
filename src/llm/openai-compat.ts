import type OpenAI from "openai";
import type { Message } from "./types.js";

/**
 * Converts internal Message[] to OpenAI-compatible chat completion messages.
 * Shared by both the OpenAI and Ollama clients since they use the same format.
 */
export function toOpenAICompatibleMessages(
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
