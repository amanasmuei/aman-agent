import OpenAI from "openai";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ChatResponse,
} from "./types.js";

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
      _tools?, // Ollama doesn't support tool use — ignored
    ): Promise<ChatResponse> {
      let fullText = "";

      try {
        const stream = await client.chat.completions.create({
          model,
          max_tokens: 8192,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content:
                typeof m.content === "string"
                  ? m.content
                  : m.content
                      .filter((b) => b.type === "text")
                      .map((b) => ("text" in b ? b.text : ""))
                      .join(""),
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

      onChunk({ type: "done" });
      return {
        message: { role: "assistant", content: fullText },
        toolUses: [],
      };
    },
  };
}
