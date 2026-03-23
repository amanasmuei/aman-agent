export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResponse {
  message: Message;
  toolUses: ToolUseRequest[];
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
    tools?: ToolDefinition[],
  ): Promise<ChatResponse>;
}
