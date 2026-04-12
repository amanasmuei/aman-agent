import path from "node:path";
import os from "node:os";
import { createDatabase, recall } from "@aman_asmuei/amem-core";
import {
  getIdentity as acoreGetIdentity,
} from "@aman_asmuei/acore-core";
import {
  listRuleCategories as arulesListCategories,
} from "@aman_asmuei/arules-core";
import type { StackProfile } from "./stack-detector.js";
import type { ProjectContext } from "./claude-md-writer.js";
import { estimateTokens } from "../token-budget.js";

const AGENT_SCOPE = process.env.AMAN_AGENT_SCOPE ?? "dev:agent";

const TOKEN_LIMITS: Record<string, number> = {
  conventions: 1500,
  decisions: 1200,
  corrections: 800,
  preferences: 500,
  rules: 800,
};

function trimToTokenBudget(items: string[], maxTokens: number): string[] {
  const result: string[] = [];
  let total = 0;
  for (const item of items) {
    const tokens = estimateTokens(item);
    if (total + tokens > maxTokens) break;
    result.push(item);
    total += tokens;
  }
  return result;
}

export interface BuildOptions {
  smart?: boolean;
  llmClient?: unknown;
}

export async function buildContext(
  stack: StackProfile,
  opts?: BuildOptions,
): Promise<ProjectContext> {
  const conventions: string[] = [];
  const decisions: string[] = [];
  const corrections: string[] = [];
  const preferences: string[] = [];
  const rules: string[] = [];
  let memoriesUsed = 0;

  // --- Query amem ---
  try {
    const amemDir = process.env.AMEM_DIR ?? path.join(os.homedir(), ".amem");
    const dbPath = process.env.AMEM_DB ?? path.join(amemDir, "memory.db");
    const db = createDatabase(dbPath);
    const query = [stack.projectName, ...stack.languages, ...stack.frameworks].join(" ");
    const result = await recall(db, { query, limit: 20 });

    for (const mem of result.memories) {
      switch ((mem as any).type) {
        case "pattern":
          conventions.push((mem as any).content);
          break;
        case "decision":
          decisions.push((mem as any).content);
          break;
        case "correction":
          corrections.push((mem as any).content);
          break;
        case "preference":
          preferences.push((mem as any).content);
          break;
      }
      memoriesUsed++;
    }
  } catch {
    // amem not available — continue without memories
  }

  // --- Query acore for identity/preferences ---
  try {
    const identity = await acoreGetIdentity(AGENT_SCOPE);
    if (identity?.content) {
      const lines = identity.content.split("\n").filter((l: string) =>
        l.startsWith("- ") && (
          l.toLowerCase().includes("prefer") ||
          l.toLowerCase().includes("style") ||
          l.toLowerCase().includes("convention")
        ),
      );
      for (const line of lines) {
        const text = line.replace(/^-\s*/, "").trim();
        if (text && !preferences.includes(text)) preferences.push(text);
      }
    }
  } catch {
    // acore not available
  }

  // --- Query arules ---
  try {
    const categories = await arulesListCategories(AGENT_SCOPE);
    // arules-core returns { name: string; rules: string[] } — rules are already filtered to active-only
    for (const cat of categories) {
      for (const ruleText of cat.rules) {
        rules.push(ruleText);
      }
    }
  } catch {
    // arules not available
  }

  // --- Apply token budgets ---
  return {
    stack,
    conventions: trimToTokenBudget(conventions, TOKEN_LIMITS.conventions),
    decisions: trimToTokenBudget(decisions, TOKEN_LIMITS.decisions),
    corrections: trimToTokenBudget(corrections, TOKEN_LIMITS.corrections),
    preferences: trimToTokenBudget(preferences, TOKEN_LIMITS.preferences),
    rules: trimToTokenBudget(rules, TOKEN_LIMITS.rules),
    metadata: {
      generatedAt: Date.now(),
      mode: opts?.smart ? "smart" : "template",
      memoriesUsed,
    },
  };
}
