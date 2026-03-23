export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  type: "text" | "tool_use" | "done";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
}

export interface LLMClient {
  chat(
    systemPrompt: string,
    messages: Message[],
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<Message>;
}
