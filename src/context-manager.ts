import type { Message, LLMClient } from "./llm/types.js";

// Rough token estimation: ~1.3 tokens per word
function estimateMessageTokens(msg: Message): number {
  if (typeof msg.content === "string") {
    return Math.round(msg.content.split(/\s+/).filter(Boolean).length * 1.3);
  }
  // Content blocks — estimate from stringified content
  let text = "";
  for (const block of msg.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_result") text += block.content;
    else if (block.type === "tool_use") text += JSON.stringify(block.input);
  }
  return Math.round(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function estimateTotalTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

// Maximum conversation tokens before trimming (leave room for system prompt + response)
const MAX_CONVERSATION_TOKENS = 80_000;
// How many recent messages to always keep
const KEEP_RECENT = 10;
// How many initial messages to always keep (session context injection)
const KEEP_INITIAL = 2;

/**
 * Trims conversation history when it gets too long.
 * Keeps initial context messages and recent messages.
 * Replaces middle messages with a summary.
 * Mutates the messages array in place.
 */
export function trimConversation(
  messages: Message[],
  _client: LLMClient,
): void {
  const totalTokens = estimateTotalTokens(messages);

  if (totalTokens < MAX_CONVERSATION_TOKENS || messages.length <= KEEP_INITIAL + KEEP_RECENT) {
    return;
  }

  // Keep first N and last N, summarize middle
  const initial = messages.slice(0, KEEP_INITIAL);
  const recent = messages.slice(-KEEP_RECENT);
  const middle = messages.slice(KEEP_INITIAL, messages.length - KEEP_RECENT);

  // Build a text summary of the middle messages
  const summaryParts: string[] = [];
  for (const msg of middle) {
    if (typeof msg.content === "string" && msg.content.length > 0) {
      const preview = msg.content.slice(0, 150);
      summaryParts.push(`[${msg.role}]: ${preview}${msg.content.length > 150 ? "..." : ""}`);
    }
  }

  const summaryText = `<conversation-summary>\nThe following is a summary of ${middle.length} earlier messages that were compressed to save context:\n\n${summaryParts.slice(0, 20).join("\n")}\n${summaryParts.length > 20 ? `\n... and ${summaryParts.length - 20} more messages` : ""}\n</conversation-summary>`;

  // Rebuild messages array in place
  messages.length = 0;
  messages.push(...initial);
  messages.push({ role: "user", content: summaryText });
  messages.push({ role: "assistant", content: "I have the context from our earlier conversation. Let's continue." });
  messages.push(...recent);
}
