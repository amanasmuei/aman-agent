import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { estimateTokens, buildBudgetedPrompt } from "./token-budget.js";
import type { PromptComponent } from "./token-budget.js";
import { loadUserIdentity, formatUserContext } from "./user-identity.js";

interface EcosystemFile {
  name: string;
  dir: string;
  file: string;
  profileOverridable?: boolean; // can be overridden by profile-specific file
}

const ECOSYSTEM_FILES: EcosystemFile[] = [
  { name: "identity", dir: ".acore", file: "core.md", profileOverridable: true },
  { name: "tools", dir: ".akit", file: "kit.md" },
  { name: "workflows", dir: ".aflow", file: "flow.md" },
  { name: "guardrails", dir: ".arules", file: "rules.md", profileOverridable: true },
  { name: "skills", dir: ".askill", file: "skills.md", profileOverridable: true },
];

/**
 * Resolve the file path for an ecosystem layer, checking profile override first.
 */
function resolveLayerPath(entry: EcosystemFile, home: string, profile?: string): string | null {
  // Check profile-specific override first
  if (profile && entry.profileOverridable) {
    const profilePath = path.join(home, ".acore", "profiles", profile, entry.file);
    if (fs.existsSync(profilePath)) return profilePath;

    // For rules/skills, also check profile dir with original filename
    if (entry.name === "guardrails") {
      const altPath = path.join(home, ".acore", "profiles", profile, "rules.md");
      if (fs.existsSync(altPath)) return altPath;
    }
    if (entry.name === "skills") {
      const altPath = path.join(home, ".acore", "profiles", profile, "skills.md");
      if (fs.existsSync(altPath)) return altPath;
    }
  }

  // Fall back to global path
  const globalPath = path.join(home, entry.dir, entry.file);
  if (fs.existsSync(globalPath)) return globalPath;

  return null;
}

export function assembleSystemPrompt(
  maxTokens?: number,
  profile?: string,
): {
  prompt: string;
  layers: string[];
  truncated: string[];
  totalTokens: number;
  profile?: string;
} {
  const home = os.homedir();
  const components: PromptComponent[] = [];

  for (const entry of ECOSYSTEM_FILES) {
    const filePath = resolveLayerPath(entry, home, profile);
    if (filePath) {
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

  // User identity — always included if available (high priority, low token cost)
  const userIdentity = loadUserIdentity();
  if (userIdentity) {
    const userContent = formatUserContext(userIdentity);
    components.push({
      name: "user",
      content: userContent,
      tokens: estimateTokens(userContent),
    });
  }

  const budgeted = buildBudgetedPrompt(components, maxTokens);

  return {
    prompt: budgeted.prompt,
    layers: budgeted.included,
    truncated: budgeted.truncated,
    totalTokens: budgeted.totalTokens,
    profile,
  };
}

/**
 * List available profiles.
 */
export function listProfiles(): Array<{ name: string; aiName: string; personality: string }> {
  const profilesDir = path.join(os.homedir(), ".acore", "profiles");
  if (!fs.existsSync(profilesDir)) return [];

  const profiles: Array<{ name: string; aiName: string; personality: string }> = [];
  for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const corePath = path.join(profilesDir, entry.name, "core.md");
    if (!fs.existsSync(corePath)) continue;

    const content = fs.readFileSync(corePath, "utf-8");
    const nameMatch = content.match(/^# (.+)/m);
    const personalityMatch = content.match(/- Personality:\s*(.+)/);

    profiles.push({
      name: entry.name,
      aiName: nameMatch?.[1]?.trim() || entry.name,
      personality: personalityMatch?.[1]?.trim() || "default",
    });
  }

  return profiles;
}

/**
 * Get the AI name for a profile (or default).
 */
export function getProfileAiName(profile?: string): string {
  const home = os.homedir();
  let corePath: string;

  if (profile) {
    const profileCorePath = path.join(home, ".acore", "profiles", profile, "core.md");
    corePath = fs.existsSync(profileCorePath) ? profileCorePath : path.join(home, ".acore", "core.md");
  } else {
    corePath = path.join(home, ".acore", "core.md");
  }

  if (!fs.existsSync(corePath)) return "Assistant";
  const content = fs.readFileSync(corePath, "utf-8");
  const match = content.match(/^# (.+)$/m);
  return match?.[1]?.trim() || "Assistant";
}
