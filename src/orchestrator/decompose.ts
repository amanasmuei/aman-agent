import { TaskDAGSchema, type TaskDAG } from "./types.js";
import { validateDAG } from "./dag.js";
import type { LLMClient } from "../llm/types.js";

// ── System prompt for decomposition ────────────────────────────────

export const DECOMPOSITION_SYSTEM_PROMPT = `You are a software project decomposer. Given a requirement, break it into a task DAG for parallel agent execution.

Return ONLY valid JSON matching this schema:
{
  "id": "orch-<short-id>",
  "name": "<short name>",
  "goal": "<one-line goal>",
  "nodes": [
    {
      "id": "<unique-id>",
      "name": "<task name>",
      "description": "<what to do>",
      "profile": "<architect|coder|tester|reviewer|security>",
      "tier": "<fast|standard|advanced>",
      "dependencies": ["<prerequisite task ids>"]
    }
  ],
  "gates": [
    {
      "id": "<gate-id>",
      "name": "<gate description>",
      "type": "approval",
      "afterNodes": ["<completed before gate>"],
      "beforeNodes": ["<blocked until gate resolves>"]
    }
  ]
}

Rules:
- architect profile = tier advanced
- coder/tester/reviewer = tier standard
- Maximize parallelism
- Add approval gate before destructive actions
- 3-12 tasks for most features`;

// ── Parse + validate an LLM response into a TaskDAG ────────────────

export function parseDecompositionResponse(response: string): TaskDAG {
  let jsonStr: string;

  // 1. Try to extract JSON from markdown code block
  const codeBlockMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1];
  } else {
    // 2. Try the whole response as JSON
    jsonStr = response;
  }

  // 3. Parse JSON
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Failed to parse decomposition response as JSON: ${jsonStr.slice(0, 200)}`,
    );
  }

  // 4. Validate through Zod schema
  const parsed = TaskDAGSchema.parse(raw);

  // 5. Validate DAG structure (cycles, refs)
  validateDAG(parsed);

  return parsed;
}

// ── LLM-driven requirement decomposition ───────────────────────────

export async function decomposeRequirement(
  requirement: string,
  client: LLMClient,
): Promise<TaskDAG> {
  const response = await client.chat(
    DECOMPOSITION_SYSTEM_PROMPT,
    [{ role: "user", content: requirement }],
    () => {}, // stream chunks are unused; we read the final message
  );

  // Extract text from response
  const text =
    typeof response.message.content === "string"
      ? response.message.content
      : response.message.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join("");

  return parseDecompositionResponse(text);
}
