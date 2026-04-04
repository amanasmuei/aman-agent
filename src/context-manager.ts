import type { Message, LLMClient } from "./llm/types.js";
import { log } from "./logger.js";

// Rough token estimation: ~1.3 tokens per word
function estimateMessageTokens(msg: Message): number {
  if (typeof msg.content === "string") {
    return Math.round(msg.content.split(/\s+/).filter(Boolean).length * 1.3);
  }
  // Content blocks — estimate from stringified content
  let text = "";
  let imageTokens = 0;
  for (const block of msg.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_result") text += block.content;
    else if (block.type === "tool_use") text += JSON.stringify(block.input);
    else if (block.type === "image") imageTokens += 1600;
  }
  return Math.round(text.split(/\s+/).filter(Boolean).length * 1.3) + imageTokens;
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
export async function trimConversation(
  messages: Message[],
  client: LLMClient,
): Promise<void> {
  const totalTokens = estimateTotalTokens(messages);

  if (totalTokens < MAX_CONVERSATION_TOKENS || messages.length <= KEEP_INITIAL + KEEP_RECENT) {
    return;
  }

  const initial = messages.slice(0, KEEP_INITIAL);
  const recent = messages.slice(-KEEP_RECENT);
  const middle = messages.slice(KEEP_INITIAL, messages.length - KEEP_RECENT);

  const middleText = middle
    .filter((m) => typeof m.content === "string" && m.content.length > 0)
    .map((m) => `[${m.role}]: ${(m.content as string).slice(0, 500)}`)
    .slice(0, 30)
    .join("\n");

  let summaryText: string;

  try {
    const summaryPrompt = "Summarize the following conversation messages in 3-5 bullet points. Preserve: decisions made, user preferences expressed, action items, and key facts discussed. Be concise.\n\n" + middleText;

    let fullText = "";
    await client.chat(
      "You are a concise summarizer. Return only bullet points, no preamble.",
      [{ role: "user", content: summaryPrompt }],
      (chunk) => {
        if (chunk.type === "text" && chunk.text) fullText += chunk.text;
      },
    );

    summaryText = `<conversation-summary>\nSummary of ${middle.length} earlier messages:\n\n${fullText}\n</conversation-summary>`;
    log.debug("context", `Summarized ${middle.length} messages via LLM`);
  } catch (err) {
    log.warn("context", "LLM summarization failed, using fallback", err);
    const summaryParts: string[] = [];
    for (const msg of middle) {
      if (typeof msg.content === "string" && msg.content.length > 0) {
        const preview = msg.content.slice(0, 150);
        summaryParts.push(`[${msg.role}]: ${preview}${msg.content.length > 150 ? "..." : ""}`);
      }
    }
    summaryText = `<conversation-summary>\nSummary of ${middle.length} earlier messages:\n\n${summaryParts.slice(0, 20).join("\n")}\n</conversation-summary>`;
  }

  messages.length = 0;
  messages.push(...initial);
  messages.push({ role: "user", content: summaryText });
  messages.push({ role: "assistant", content: "I have the context from our earlier conversation. Let's continue." });
  messages.push(...recent);
}
