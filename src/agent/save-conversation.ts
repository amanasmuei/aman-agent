import type { Message } from "../llm/types.js";
import { memoryLog } from "../memory.js";
import { log } from "../logger.js";

export async function saveConversationToMemory(
  messages: Message[],
  sessionId: string,
): Promise<void> {
  // Save last 50 messages
  const recentMessages = messages.slice(-50);

  for (const msg of recentMessages) {
    if (typeof msg.content !== "string") continue;
    try {
      memoryLog(sessionId, msg.role, msg.content.slice(0, 5000));
    } catch (err) {
      log.debug("agent", "memory_log write failed", err);
    }
  }
}
