import { spawn, execFileSync } from "node:child_process";
import type {
  LLMClient,
  Message,
  StreamChunk,
  ToolDefinition,
  ChatResponse,
  ChatOptions,
  ContentBlock,
} from "./types.js";

/**
 * Check if the `copilot` CLI is installed.
 */
export function isCopilotCliInstalled(): boolean {
  try {
    execFileSync("which", ["copilot"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the `copilot` CLI is authenticated.
 */
export function isCopilotCliAuthenticated(): boolean {
  try {
    const result = execFileSync("copilot", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return result.toString().trim().length > 0;
  } catch {
    return false;
  }
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_result")
        return `[Tool result for ${block.tool_use_id}]: ${block.content}`;
      if (block.type === "tool_use") return `[Used tool: ${block.name}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Format conversation history into a single prompt for the CLI.
 * The copilot CLI in print mode is single-turn, so we flatten the
 * multi-turn conversation into context.
 */
function formatConversation(
  systemPrompt: string,
  messages: Message[],
  tools?: ToolDefinition[],
): { prompt: string; systemPrompt: string } {
  const parts: string[] = [];

  let fullSystem = systemPrompt;
  if (tools && tools.length > 0) {
    fullSystem += "\n\n## Available Tools\n";
    fullSystem +=
      "You have access to the following tools. To use a tool, respond with a JSON block in this exact format:\n";
    fullSystem +=
      '```json\n{"tool_use": {"id": "call_1", "name": "tool_name", "input": {…}}}\n```\n\n';
    for (const tool of tools) {
      fullSystem += `### ${tool.name}\n${tool.description}\nParameters: ${JSON.stringify(tool.input_schema)}\n\n`;
    }
    fullSystem +=
      "You may include multiple tool_use blocks. After each tool use, you will receive the result and can continue.\n";
  }

  if (messages.length > 1) {
    parts.push("<conversation_history>");
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      const role = msg.role === "user" ? "User" : "Assistant";
      const text = extractText(msg.content);
      parts.push(`[${role}]: ${text}`);
    }
    parts.push("</conversation_history>\n");
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg) {
    parts.push(extractText(lastMsg.content));
  }

  return { prompt: parts.join("\n"), systemPrompt: fullSystem };
}

/**
 * Parse tool_use JSON blocks from the assistant's text response.
 */
function parseToolUses(
  text: string,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];

  const codeBlockRegex = /```json\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool_use) {
        toolUses.push({
          id: parsed.tool_use.id || `call_${toolUses.length + 1}`,
          name: parsed.tool_use.name,
          input: parsed.tool_use.input || {},
        });
      }
    } catch {
      // Not valid JSON
    }
  }

  if (toolUses.length === 0) {
    const inlineRegex =
      /\{"tool_use"\s*:\s*\{[^}]*"name"\s*:\s*"[^"]+?"[^}]*\}\s*\}/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool_use) {
          toolUses.push({
            id: parsed.tool_use.id || `call_${toolUses.length + 1}`,
            name: parsed.tool_use.name,
            input: parsed.tool_use.input || {},
          });
        }
      } catch {
        // Not valid JSON
      }
    }
  }

  return toolUses;
}

export function createCopilotClient(model?: string): LLMClient {
  return {
    async chat(
      systemPrompt: string,
      messages: Message[],
      onChunk: (chunk: StreamChunk) => void,
      tools?: ToolDefinition[],
      options?: ChatOptions,
    ): Promise<ChatResponse> {
      const { prompt, systemPrompt: fullSystem } = formatConversation(
        systemPrompt,
        messages,
        tools,
      );

      return new Promise((resolve, reject) => {
        const args = [
          "--print",
          "--output-format", "json",
          "--silent",
          "--no-custom-instructions",
        ];

        if (model) {
          args.push("--model", model);
        }

        // Pass prompt as the positional argument
        args.push(prompt);

        const proc = spawn("copilot", args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            COPILOT_SYSTEM_PROMPT: fullSystem,
          },
        });

        let fullText = "";
        let buffer = "";
        let stderrOutput = "";

        proc.stdout.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);

              // Handle JSONL output from copilot CLI
              if (event.type === "assistant" && event.content) {
                fullText += event.content;
                onChunk({ type: "text", text: event.content });
              } else if (event.type === "message" && event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === "text" && block.text) {
                    fullText += block.text;
                    onChunk({ type: "text", text: block.text });
                  }
                }
              } else if (event.type === "content_block_delta") {
                if (event.delta?.type === "text_delta" && event.delta.text) {
                  fullText += event.delta.text;
                  onChunk({ type: "text", text: event.delta.text });
                }
              } else if (event.role === "assistant" && event.content) {
                // Some formats return {role, content} directly
                const text =
                  typeof event.content === "string"
                    ? event.content
                    : event.content
                        .map((b: { text?: string }) => b.text || "")
                        .join("");
                if (text) {
                  fullText += text;
                  onChunk({ type: "text", text });
                }
              }
              // Skip "result" type to avoid duplication
            } catch {
              // Not JSON — treat as raw text
              if (line.trim()) {
                fullText += line;
                onChunk({ type: "text", text: line });
              }
            }
          }
        });

        proc.stderr.on("data", (data: Buffer) => {
          stderrOutput += data.toString();
        });

        proc.on("close", (code) => {
          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer);
              if (event.type === "assistant" && event.content) {
                fullText += event.content;
                onChunk({ type: "text", text: event.content });
              } else if (
                event.role === "assistant" &&
                typeof event.content === "string"
              ) {
                fullText += event.content;
                onChunk({ type: "text", text: event.content });
              }
            } catch {
              if (buffer.trim()) {
                fullText += buffer;
                onChunk({ type: "text", text: buffer });
              }
            }
          }

          onChunk({ type: "done" });

          if (code !== 0 && !fullText) {
            reject(
              new Error(
                `Copilot CLI exited with code ${code}${stderrOutput ? `: ${stderrOutput.trim()}` : ""}`,
              ),
            );
            return;
          }

          // Check for tool use in the response
          const hasTools = tools && tools.length > 0;
          if (hasTools) {
            const toolUses = parseToolUses(fullText);
            if (toolUses.length > 0) {
              let cleanText = fullText;
              const stripRegex = /```json\s*\n?\s*\{"tool_use"[\s\S]*?```/g;
              cleanText = cleanText.replace(stripRegex, "").trim();

              const contentBlocks: ContentBlock[] = [];
              if (cleanText) {
                contentBlocks.push({ type: "text", text: cleanText });
              }
              for (const tu of toolUses) {
                contentBlocks.push({
                  type: "tool_use",
                  id: tu.id,
                  name: tu.name,
                  input: tu.input,
                });
              }

              resolve({
                message: { role: "assistant", content: contentBlocks },
                toolUses,
              });
              return;
            }
          }

          resolve({
            message: { role: "assistant", content: fullText },
            toolUses: [],
          });
        });

        proc.on("error", (err) => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(
              new Error(
                "Copilot CLI not found. Install it from: https://docs.github.com/copilot/how-tos/copilot-cli",
              ),
            );
          } else {
            reject(err);
          }
        });
      });
    },
  };
}
