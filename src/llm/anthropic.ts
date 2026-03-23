import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
  ChatResponse,
  ContentBlock,
} from "./types.js";

function toAnthropicMessages(
  messages: Message[],
): Anthropic.Messages.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    // Complex content blocks (tool_use, tool_result, etc.)
    return {
      role: m.role,
      content: m.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        if (block.type === "tool_use") {
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        if (block.type === "tool_result") {
          return {
            type: "tool_result" as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
          };
        }
        return { type: "text" as const, text: "" };
      }),
    };
  });
}

export function createAnthropicClient(
  apiKey: string,
  model: string,
): LLMClient {
  const client = new Anthropic({ apiKey });

  return {
    async chat(
      systemPrompt: string,
      messages: Message[],
      onChunk: (chunk: StreamChunk) => void,
      tools?: ToolDefinition[],
    ): Promise<ChatResponse> {
      const anthropicMessages = toAnthropicMessages(messages);
      const hasTools = tools && tools.length > 0;

      try {
        if (hasTools) {
          // Non-streaming when tools are present for simpler tool_use handling
          const response = await client.messages.create({
            model,
            max_tokens: 8192,
            system: systemPrompt,
            messages: anthropicMessages,
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.input_schema as Anthropic.Messages.Tool["input_schema"],
            })),
          });

          const toolUses = response.content
            .filter(
              (block): block is Anthropic.Messages.ToolUseBlock =>
                block.type === "tool_use",
            )
            .map((block) => ({
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            }));

          const textContent = response.content
            .filter(
              (block): block is Anthropic.Messages.TextBlock =>
                block.type === "text",
            )
            .map((block) => block.text)
            .join("");

          // Stream text to output if there's text and no tool calls
          if (textContent && toolUses.length === 0) {
            onChunk({ type: "text", text: textContent });
            onChunk({ type: "done" });
          } else if (textContent) {
            // There's text alongside tool calls — show it
            onChunk({ type: "text", text: textContent });
          }

          // Build the content blocks for the message
          const contentBlocks: ContentBlock[] = response.content.map(
            (block) => {
              if (block.type === "text") {
                return { type: "text" as const, text: block.text };
              }
              // tool_use
              return {
                type: "tool_use" as const,
                id: (block as Anthropic.Messages.ToolUseBlock).id,
                name: (block as Anthropic.Messages.ToolUseBlock).name,
                input: (block as Anthropic.Messages.ToolUseBlock)
                  .input as Record<string, unknown>,
              };
            },
          );

          return {
            message: {
              role: "assistant",
              content: toolUses.length > 0 ? contentBlocks : textContent,
            },
            toolUses,
          };
        } else {
          // Streaming when no tools — original behavior
          let fullText = "";

          const stream = await client.messages.create({
            model,
            max_tokens: 8192,
            system: systemPrompt,
            messages: anthropicMessages,
            stream: true,
          });

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const text = event.delta.text;
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
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error(
            "Invalid API key. Run with --model flag or delete ~/.aman-agent/config.json to reconfigure.",
          );
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new Error("Rate limited by Anthropic. Please wait and retry.");
        }
        throw error;
      }
    },
  };
}
