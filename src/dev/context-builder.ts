import fs from "node:fs";
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
    if (typeof item !== "string" || !item) continue;
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

    // Skip if database doesn't exist — avoids loading HuggingFace models for nothing
    // But allow override via AMEM_DB env var (also needed for tests with mocked createDatabase)
    if (!process.env.AMEM_DB && !fs.existsSync(dbPath)) throw new Error("no db");

    const db = createDatabase(dbPath);
    const query = [stack.projectName, ...stack.languages, ...stack.frameworks].join(" ");
    // rerank: false skips the cross-encoder model — much faster startup
    const result = await recall(db, { query, limit: 20, compact: false, rerank: false });

    for (const mem of result.memories) {
      const content = (mem as any).content;
      if (typeof content !== "string" || !content) continue;
      switch ((mem as any).type) {
        case "pattern":
          if (!conventions.includes(content)) conventions.push(content);
          break;
        case "decision":
          if (!decisions.includes(content)) decisions.push(content);
          break;
        case "correction":
          if (!corrections.includes(content)) corrections.push(content);
          break;
        case "preference":
          if (!preferences.includes(content)) preferences.push(content);
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
        if (typeof ruleText === "string" && ruleText && !rules.includes(ruleText)) {
          rules.push(ruleText);
        }
      }
    }
  } catch {
    // arules not available
  }

  // --- Smart mode: LLM synthesis ---
  if (opts?.smart && opts.llmClient) {
    try {
      const client = opts.llmClient as { chat: (system: string, msgs: { role: string; content: string }[], onChunk: () => void) => Promise<{ message: { content: string | { text?: string }[] } }> };
      const rawData = [
        `Project: ${stack.projectName}`,
        `Stack: ${stack.languages.join(", ")} + ${stack.frameworks.join(", ")}`,
        `Databases: ${stack.databases.join(", ") || "none detected"}`,
        "",
        conventions.length > 0 ? `Conventions:\n${conventions.map((c) => `- ${c}`).join("\n")}` : "",
        decisions.length > 0 ? `Decisions:\n${decisions.map((d) => `- ${d}`).join("\n")}` : "",
        corrections.length > 0 ? `Corrections:\n${corrections.map((c) => `- ${c}`).join("\n")}` : "",
        preferences.length > 0 ? `Preferences:\n${preferences.map((p) => `- ${p}`).join("\n")}` : "",
        rules.length > 0 ? `Rules:\n${rules.map((r) => `- ${r}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");

      const response = await client.chat(
        "You are a developer context assembler. Given raw developer history, output a merged, deduplicated set of conventions and decisions as markdown bullet lists. Group by: Conventions, Decisions, Corrections, Preferences, Rules. Be specific, not generic. Max 3000 tokens.",
        [{ role: "user", content: rawData }],
        () => {},
      );

      // Parse LLM response to extract synthesized sections
      const text = typeof response.message.content === "string"
        ? response.message.content
        : response.message.content.map((b: { text?: string }) => b.text ?? "").join("");

      // Extract bullet points from each section the LLM generated
      const extractSection = (sectionName: string): string[] => {
        const regex = new RegExp(`##?\\s*${sectionName}[\\s\\S]*?(?=##|$)`, "i");
        const match = text.match(regex);
        if (!match) return [];
        return match[0].split("\n").filter((l) => l.startsWith("- ")).map((l) => l.replace(/^-\s*/, "").trim());
      };

      const smartConventions = extractSection("Conventions");
      const smartDecisions = extractSection("Decisions");
      const smartCorrections = extractSection("Corrections");
      const smartPreferences = extractSection("Preferences");
      const smartRules = extractSection("Rules");

      return {
        stack,
        conventions: trimToTokenBudget(smartConventions.length > 0 ? smartConventions : conventions, TOKEN_LIMITS.conventions),
        decisions: trimToTokenBudget(smartDecisions.length > 0 ? smartDecisions : decisions, TOKEN_LIMITS.decisions),
        corrections: trimToTokenBudget(smartCorrections.length > 0 ? smartCorrections : corrections, TOKEN_LIMITS.corrections),
        preferences: trimToTokenBudget(smartPreferences.length > 0 ? smartPreferences : preferences, TOKEN_LIMITS.preferences),
        rules: trimToTokenBudget(smartRules.length > 0 ? smartRules : rules, TOKEN_LIMITS.rules),
        metadata: {
          generatedAt: Date.now(),
          mode: "smart" as const,
          memoriesUsed,
        },
      };
    } catch {
      // LLM failed — fall through to template mode
    }
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
      mode: "template" as const,
      memoriesUsed,
    },
  };
}
