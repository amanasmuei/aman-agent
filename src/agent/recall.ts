import { memoryRecall, getMaxRecallTokens } from "../memory.js";
import { log } from "../logger.js";

export interface AgentRecallResult {
  text: string;
  tokenEstimate: number;
}

export async function recallForMessage(
  input: string,
): Promise<AgentRecallResult | null> {
  try {
    const result = await memoryRecall(input, { limit: 5, compact: true });
    if (result.total === 0) {
      return null;
    }
    const tokenEstimate = result.tokenEstimate ?? Math.round(result.text.split(/\s+/).filter(Boolean).length * 1.3);
    const MAX_MEMORY_TOKENS = getMaxRecallTokens();
    let memoryText = result.text;
    if (tokenEstimate > MAX_MEMORY_TOKENS) {
      const maxChars = MAX_MEMORY_TOKENS * 4;
      memoryText = memoryText.slice(0, maxChars) + "\n[... memory truncated to fit token budget]";
      log.debug("agent", `memory recall truncated from ~${tokenEstimate} to ~${MAX_MEMORY_TOKENS} tokens`);
    }
    return {
      text: `\n\n<relevant-memories>\n${memoryText}\n</relevant-memories>`,
      tokenEstimate: Math.min(tokenEstimate, MAX_MEMORY_TOKENS),
    };
  } catch (err) {
    log.debug("agent", "memory recall failed", err);
    return null;
  }
}
