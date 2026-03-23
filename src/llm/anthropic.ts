import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, Message, StreamChunk } from "./types.js";

export function createAnthropicClient(
  apiKey: string,
  model: string,
): LLMClient {
  const client = new Anthropic({ apiKey });

  return {
    async chat(systemPrompt, messages, onChunk) {
      let fullText = "";

      try {
        const stream = await client.messages.create({
          model,
          max_tokens: 8192,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
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

      onChunk({ type: "done" });
      return { role: "assistant", content: fullText };
    },
  };
}
