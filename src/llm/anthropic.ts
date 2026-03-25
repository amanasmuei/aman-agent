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
        let fullText = "";
        const toolUseBlocks: Array<{
          id: string;
          name: string;
          inputJson: string;
        }> = [];
        let currentBlockType: "text" | "tool_use" | null = null;
        let currentBlockIndex = -1;

        const createParams: Record<string, unknown> = {
          model,
          max_tokens: 8192,
          system: systemPrompt,
          messages: anthropicMessages,
          stream: true,
        };

        if (hasTools) {
          createParams.tools = tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema:
              t.input_schema as Anthropic.Messages.Tool["input_schema"],
          }));
        }

        const stream = await client.messages.create(
          createParams as unknown as Anthropic.Messages.MessageCreateParamsStreaming,
        );

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            currentBlockIndex = event.index;
            if (event.content_block.type === "text") {
              currentBlockType = "text";
            } else if (event.content_block.type === "tool_use") {
              currentBlockType = "tool_use";
              toolUseBlocks.push({
                id: event.content_block.id,
                name: event.content_block.name,
                inputJson: "",
              });
            }
          } else if (event.type === "content_block_delta") {
            if (
              currentBlockType === "text" &&
              event.delta.type === "text_delta"
            ) {
              const text = event.delta.text;
              fullText += text;
              onChunk({ type: "text", text });
            } else if (
              currentBlockType === "tool_use" &&
              event.delta.type === "input_json_delta"
            ) {
              const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
              if (lastTool) {
                lastTool.inputJson += event.delta.partial_json;
              }
            }
          } else if (event.type === "content_block_stop") {
            currentBlockType = null;
          }
        }

        // Parse tool inputs from accumulated JSON
        const toolUses = toolUseBlocks.map((block) => ({
          id: block.id,
          name: block.name,
          input: (block.inputJson
            ? JSON.parse(block.inputJson)
            : {}) as Record<string, unknown>,
        }));

        // Signal done
        onChunk({ type: "done" });

        // Build content blocks for the message
        if (toolUses.length > 0) {
          const contentBlocks: ContentBlock[] = [];
          if (fullText) {
            contentBlocks.push({ type: "text" as const, text: fullText });
          }
          for (const tu of toolUses) {
            contentBlocks.push({
              type: "tool_use" as const,
              id: tu.id,
              name: tu.name,
              input: tu.input,
            });
          }
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
