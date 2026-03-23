import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { estimateTokens, buildBudgetedPrompt } from "./token-budget.js";
import type { PromptComponent } from "./token-budget.js";

interface EcosystemFile {
  name: string;
  dir: string;
  file: string;
}

const ECOSYSTEM_FILES: EcosystemFile[] = [
  { name: "identity", dir: ".acore", file: "core.md" },
  { name: "tools", dir: ".akit", file: "kit.md" },
  { name: "workflows", dir: ".aflow", file: "flow.md" },
  { name: "guardrails", dir: ".arules", file: "rules.md" },
  { name: "skills", dir: ".askill", file: "skills.md" },
];

export function assembleSystemPrompt(maxTokens?: number): {
  prompt: string;
  layers: string[];
  truncated: string[];
  totalTokens: number;
} {
  const home = os.homedir();
  const components: PromptComponent[] = [];

  for (const entry of ECOSYSTEM_FILES) {
    const filePath = path.join(home, entry.dir, entry.file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      components.push({
        name: entry.name,
        content,
        tokens: estimateTokens(content),
      });
    }
  }

  // Project context (not prioritized — appended as extra)
  const contextPath = path.join(process.cwd(), ".acore", "context.md");
  if (fs.existsSync(contextPath)) {
    const content = fs.readFileSync(contextPath, "utf-8").trim();
    components.push({
      name: "context",
      content,
      tokens: estimateTokens(content),
    });
  }

  const budgeted = buildBudgetedPrompt(components, maxTokens);

  return {
    prompt: budgeted.prompt,
    layers: budgeted.included,
    truncated: budgeted.truncated,
    totalTokens: budgeted.totalTokens,
  };
}
