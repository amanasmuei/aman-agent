import type { LLMClient } from "./llm/types.js";
import { log } from "./logger.js";
import { matchPatternToSkill, enrichSkill } from "./skill-engine.js";
import { memoryRecall, memoryStore, getDb } from "./memory.js";
import { autoRelateMemory, reflect, isReflectionDue } from "@aman_asmuei/amem-core";

export interface ExtractionCandidate {
  content: string;
  type: "preference" | "fact" | "pattern" | "decision" | "correction" | "topology";
  tags: string[];
  confidence: number;
  scope: string;
}

const VALID_TYPES = new Set(["preference", "fact", "pattern", "topology", "decision", "correction"]);
const MIN_RESPONSE_LENGTH = 50;
const MIN_TURNS_BETWEEN_EMPTY = 3;

const EXTRACTION_PROMPT = `Analyze this conversation turn. Extract any information worth remembering long-term.

Return a JSON array (empty [] if nothing worth storing):
[{
  "content": "what to remember — be specific and self-contained",
  "type": "preference|fact|pattern|decision|correction|topology",
  "tags": ["relevant", "tags"],
  "confidence": 0.0-1.0,
  "scope": "global"
}]

Type guide:
- "preference" = user likes/dislikes/preferences
- "fact" = objective information about systems, people, projects
- "pattern" = recurring behavior, coding style, approach
- "topology" = how systems/components connect to each other
- "decision" = explicit choice between alternatives
- "correction" = user correcting a prior wrong assumption

Rules:
- Only extract genuinely useful LONG-TERM information
- Skip ephemeral things ("user asked about X" is NOT useful)
- Be conservative — 90% of turns produce nothing worth storing
- Return ONLY the JSON array, no other text`;

export function shouldExtract(
  assistantResponse: string,
  turnsSinceLastExtraction: number,
  lastExtractionCount: number,
): boolean {
  // Always skip very short responses regardless of previous extraction results
  if (assistantResponse.length < MIN_RESPONSE_LENGTH) return false;
  // If previous turn found memories, extract again but respect min turns spacing
  if (lastExtractionCount > 0 && turnsSinceLastExtraction >= 1) return true;
  // Otherwise, wait for MIN_TURNS_BETWEEN_EMPTY turns between empty extractions
  if (turnsSinceLastExtraction < MIN_TURNS_BETWEEN_EMPTY) return false;
  return true;
}

export function parseExtractionResult(raw: string): ExtractionCandidate[] {
  try {
    let cleaned = raw.trim();
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: Record<string, unknown>) =>
        typeof item.content === "string" &&
        item.content.length > 0 &&
        typeof item.type === "string" &&
        VALID_TYPES.has(item.type),
    ) as ExtractionCandidate[];
  } catch {
    return [];
  }
}

export interface ExtractorState {
  turnsSinceLastExtraction: number;
  lastExtractionCount: number;
}

export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  client: LLMClient,
  state: ExtractorState,
): Promise<number> {
  if (!shouldExtract(assistantResponse, state.turnsSinceLastExtraction, state.lastExtractionCount)) {
    state.turnsSinceLastExtraction++;
    return 0;
  }

  try {
    const conversationTurn = `User: ${userMessage.slice(0, 2000)}\n\nAssistant: ${assistantResponse.slice(0, 2000)}`;

    let fullText = "";
    await client.chat(
      EXTRACTION_PROMPT,
      [{ role: "user", content: conversationTurn }],
      (chunk) => {
        if (chunk.type === "text" && chunk.text) fullText += chunk.text;
      },
    );

    const candidates = parseExtractionResult(fullText);
    state.turnsSinceLastExtraction = 0;
    state.lastExtractionCount = candidates.length;

    if (candidates.length === 0) return 0;

    let stored = 0;

    for (const candidate of candidates) {
      // Dedup check
      try {
        const existing = await memoryRecall(candidate.content, { limit: 1 });
        if (existing.total > 0 && existing.memories.length > 0) {
          const topScore = (existing.memories[0] as { score?: number })?.score;
          if (topScore && topScore > 0.85) {
            log.debug("extractor", "Skipping duplicate: " + candidate.content);
            continue;
          }
        }
      } catch { /* Dedup failed, proceed */ }

      // Store
      try {
        const storeResult = await memoryStore({
          content: candidate.content,
          type: candidate.type,
          tags: candidate.tags,
          confidence: candidate.confidence,
          source: "auto-extraction",
          scope: candidate.scope,
        });
        if (storeResult.action !== "private") {
          stored++;
          log.debug("extractor", "Stored " + candidate.type + ": " + candidate.content);
          // Fire-and-forget: build knowledge graph links in background
          try {
            autoRelateMemory(getDb(), storeResult.id);
          } catch {
            // Relation-building is best-effort — never block extraction
          }
          // Self-improving skills: enrich skills with learned patterns
          if (candidate.type === "pattern" || candidate.type === "preference") {
            const skillMatch = matchPatternToSkill(candidate.content, candidate.tags);
            if (skillMatch) {
              enrichSkill(skillMatch, candidate.content);
            }
          }
        }
      } catch (err) {
        log.warn("extractor", "Failed to store: " + candidate.content, err);
      }
    }

    // Post-extraction: trigger reflection if enough memories have accumulated
    if (stored > 0 && isReflectionDue(getDb()).due) {
      try {
        reflect(getDb());
      } catch {
        // Reflection is background synthesis — never block extraction result
      }
    }

    return stored;
  } catch (err) {
    log.debug("extractor", "extraction failed", err);
    state.turnsSinceLastExtraction = 0;
    state.lastExtractionCount = 0;
    return 0;
  }
}
