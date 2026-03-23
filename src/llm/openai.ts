import OpenAI from "openai";
import type { LLMClient, Message, StreamChunk } from "./types.js";

export function createOpenAIClient(apiKey: string, model: string): LLMClient {
  const client = new OpenAI({ apiKey });

  return {
    async chat(systemPrompt, messages, onChunk) {
      let fullText = "";

      try {
        const stream = await client.chat.completions.create({
          model,
          max_tokens: 8192,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            fullText += text;
            onChunk({ type: "text", text });
          }
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

      onChunk({ type: "done" });
      return { role: "assistant", content: fullText };
    },
  };
}
