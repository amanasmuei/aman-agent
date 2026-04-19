declare const __VERSION__: string;

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import type { McpManager } from "./mcp/client.js";
import { getEcosystemStatus } from "./layers/parsers.js";
import { memoryContext, memoryRecall, memoryMultiRecall, memoryForget, memoryStats, memoryExport, memorySince, memorySearch, isMemoryInitialized, reminderSet, reminderList, reminderCheck, reminderComplete, memoryDoctor, memoryRepair, memoryConfig, memoryReflect, memoryConsolidate, memoryTier, memoryDetail, memoryRelate, memoryExpire, memoryVersions, memorySync, getMirrorEngine, syncFromMirrorDir } from "./memory.js";
import { expandHome } from "./config.js";
import { listProfiles } from "./prompt.js";
import { BUILT_IN_PROFILES, installProfileTemplate } from "./profile-templates.js";
import { loadUserIdentity, hasUserIdentity } from "./user-identity.js";
import { runOnboarding, editProfile } from "./onboarding.js";
import { loadShowcaseManifest, installShowcaseTemplate } from "./showcase-bridge.js";
import { readFile, listFiles } from "./files.js";
import { delegateTask, delegatePipeline } from "./delegate.js";
import { smartOrchestrate, createModelRouter } from "./orchestrator/index.js";
import { listAgents, findAgent } from "./server/registry.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  createTeam,
  loadTeam,
  listTeams,
  deleteTeam,
  runTeam,
  formatTeam,
  formatTeamResult,
  BUILT_IN_TEAMS,
  type Team,
} from "./teams.js";
import {
  createPlan,
  getActivePlan,
  listPlans,
  loadPlan,
  markStepDone,
  markStepUndone,
  setActivePlan,
  formatPlan,
} from "./plans.js";
import {
  type ObservationSession,
  recordEvent,
  getSessionStats,
  pauseObservation,
  resumeObservation,
} from "./observation.js";
import {
  generatePostmortemReport,
  savePostmortem,
  listPostmortems,
  readPostmortem,
  analyzePostmortemRange,
  formatPostmortemMarkdown,
} from "./postmortem.js";
import {
  ghAvailable,
  ghCurrentRepo,
  listPRs,
  fetchIssue,
  formatIssueAsRequirement,
  isCIPassing,
} from "./github/index.js";
import {
  validateCandidate,
  writeSkillToFile,
  appendCrystallizationLog,
  loadSuggestionCounts,
} from "./crystallization.js";
import {
  loadUserModel,
  defaultModelPath,
  computeProfile,
  predictBurnout,
} from "./user-model.js";
import { loadTaskLog } from "./background.js";

// ── aman engine layers (Phase 5: replace file IO + mcpWrite for identity/rules) ──
import {
  getIdentity as acoreGetIdentity,
  updateSection as acoreUpdateSection,
  updateDynamics as acoreUpdateDynamics,
} from "@aman_asmuei/acore-core";
import {
  listRuleCategories as arulesListCategories,
  addRule as arulesAddRule,
  removeRule as arulesRemoveRule,
  toggleRuleAt as arulesToggleRule,
  checkAction as arulesCheckAction,
} from "@aman_asmuei/arules-core";

/**
 * Canonical scope for aman-agent's slash commands. The CLI runtime is
 * the dev's `dev:agent` surface — distinct from `dev:plugin` (Claude Code)
 * and `dev:default` (the legacy single-tenant catch-all).
 *
 * Override at runtime with $AMAN_AGENT_SCOPE if you want a different
 * default (e.g. `dev:work` vs `dev:personal`).
 */
const AGENT_SCOPE: string =
  process.env.AMAN_AGENT_SCOPE ?? "dev:agent";

export interface CommandResult {
  handled: boolean;
  output?: string;
  quit?: boolean;
  clearHistory?: boolean;
  saveConversation?: boolean;
  exportConversation?: boolean;
}

export interface CommandContext {
  model?: string;
  mcpManager?: McpManager;
  llmClient?: import("./llm/types.js").LLMClient;
  tools?: import("./llm/types.js").ToolDefinition[];
  observationSession?: ObservationSession;
  messages?: import("./llm/types.js").Message[];
}

function readEcosystemFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    return pc.dim(`No ${label} file found at ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8").trim();
}

function parseCommand(input: string): { base: string; action?: string; args: string[] } {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const base = parts[0].toLowerCase().replace(/^\//, "");
  let action = parts.length > 1 ? parts[1].toLowerCase() : undefined;
  if (action === "--help" || action === "-h") action = "help";
  const args = parts.slice(2);
  return { base, action, args };
}

/**
 * Parse dot-notation key (e.g. "consolidation.maxStaleDays") into nested object.
 * Returns { consolidation: { maxStaleDays: val } } instead of { "consolidation.maxStaleDays": val }
 */
function buildNestedUpdate(key: string, val: unknown): Record<string, unknown> {
  const parts = key.split(".");
  if (parts.length === 1) return { [key]: val };
  const result: Record<string, unknown> = {};
  let curr = result;
  for (let i = 0; i < parts.length - 1; i++) {
    curr[parts[i]] = {};
    curr = curr[parts[i]] as Record<string, unknown>;
  }
  curr[parts[parts.length - 1]] = val;
  return result;
}

async function mcpWrite(
  ctx: CommandContext,
  layer: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!ctx.mcpManager) {
    return pc.red(`Cannot modify ${layer}: aman-mcp not connected. Start it with: npx @aman_asmuei/aman-mcp`);
  }
  const result = await ctx.mcpManager.callTool(tool, args);
  if (result.startsWith("Error")) {
    return pc.red(result);
  }
  return pc.green(result);
}

// --- Layer Handlers ---

async function handleIdentityCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    const identity = await acoreGetIdentity(AGENT_SCOPE);
    if (!identity) {
      return {
        handled: true,
        output: pc.dim(
          `No identity configured for ${AGENT_SCOPE}. Run: npx @aman_asmuei/acore`,
        ),
      };
    }
    return { handled: true, output: identity.content.trim() };
  }
  if (action === "update") {
    if (args.length === 0) {
      return {
        handled: true,
        output: pc.yellow(
          "Usage: /identity update <section>\nTip: describe changes in natural language and the AI will update via acore-core.",
        ),
      };
    }
    const section = args[0];
    const content = args.slice(1).join(" ");
    if (!content) {
      return {
        handled: true,
        output: pc.yellow(
          "Usage: /identity update <section> <new content...>\nExample: /identity update Personality Warm, curious, and direct.",
        ),
      };
    }
    try {
      await acoreUpdateSection(section, content, AGENT_SCOPE);
      return { handled: true, output: pc.green(`Updated section: ${section}`) };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed to update ${section}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }
  }
  if (action === "dynamics") {
    // --json flag: raw JSON output
    if (args.includes("--json")) {
      const model = await loadUserModel();
      if (!model) return { handled: true, output: pc.dim("No user model yet. Complete a few sessions first.") };
      return { handled: true, output: JSON.stringify(model, null, 2) };
    }

    // --reset flag: delete model
    if (args.includes("--reset")) {
      const modelPath = defaultModelPath();
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        return { handled: true, output: pc.green("User model reset. Starting fresh.") };
      }
      return { handled: true, output: pc.dim("No user model to reset.") };
    }

    // key=val args: manual dynamics override (existing behavior)
    const updates: Record<string, string> = {};
    for (const arg of args) {
      const eq = arg.indexOf("=");
      if (eq > 0) updates[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
    if (Object.keys(updates).length > 0) {
      try {
        await acoreUpdateDynamics({
          energy: updates.energy,
          activeMode: updates.mode,
          currentRead: updates.read,
        }, AGENT_SCOPE);
        return { handled: true, output: `Dynamics updated: ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(", ")}` };
      } catch (err) {
        return { handled: true, output: pc.red(`Dynamics error: ${err instanceof Error ? err.message : String(err)}`) };
      }
    }

    // No args: show user model summary
    const model = await loadUserModel();
    if (!model) {
      return { handled: true, output: pc.dim("No user model yet. Complete a few sessions to start building your profile.") };
    }

    const p = model.profile;
    const trustBar = "█".repeat(Math.round(p.trustScore * 10)) + "░".repeat(10 - Math.round(p.trustScore * 10));
    const frustBar = "█".repeat(Math.round(p.baselineFrustration * 10)) + "░".repeat(10 - Math.round(p.baselineFrustration * 10));

    const lines = [
      pc.bold("  Dynamic User Model"),
      "",
      `  ${pc.cyan("Trust")}        ${trustBar} ${(p.trustScore * 100).toFixed(0)}%  ${p.trustTrajectory === "ascending" ? pc.green("↑") : p.trustTrajectory === "declining" ? pc.red("↓") : "→"}`,
      `  ${pc.cyan("Sessions")}     ${p.totalSessions} total (${model.sessions.length} in window)`,
      `  ${pc.cyan("Sentiment")}    ${frustBar} frustration baseline  ${p.sentimentTrend === "improving" ? pc.green("improving") : p.sentimentTrend === "worsening" ? pc.red("worsening") : "stable"}`,
      "",
      `  ${pc.cyan("Preferred")}    ${p.preferredTimePeriod} (${Object.entries(p.energyDistribution).map(([k, v]) => `${k}: ${v}`).join(", ")})`,
      `  ${pc.cyan("Avg session")}  ${p.avgSessionMinutes.toFixed(0)} min, ${p.avgTurnsPerSession.toFixed(0)} turns  ${p.engagementTrend === "increasing" ? pc.green("↑") : p.engagementTrend === "decreasing" ? pc.red("↓") : "→"}`,
    ];

    // Frustration correlations (only show if enough data)
    if (p.totalSessions >= 10) {
      const corrs: string[] = [];
      if (Math.abs(p.frustrationCorrelations.toolErrors) > 0.3) {
        corrs.push(`tool errors (${p.frustrationCorrelations.toolErrors.toFixed(2)})`);
      }
      if (Math.abs(p.frustrationCorrelations.longSessions) > 0.3) {
        corrs.push(`long sessions (${p.frustrationCorrelations.longSessions.toFixed(2)})`);
      }
      if (Math.abs(p.frustrationCorrelations.lateNight) > 0.3) {
        corrs.push(`late night (${p.frustrationCorrelations.lateNight.toFixed(2)})`);
      }
      if (corrs.length > 0) {
        lines.push(`  ${pc.cyan("Frustration")}  correlates with: ${corrs.join(", ")}`);
      }
    }

    // Nudge stats
    const nudgeKeys = Object.keys(p.nudgeStats);
    if (nudgeKeys.length > 0) {
      lines.push("");
      lines.push(`  ${pc.cyan("Nudges")}       ${nudgeKeys.map(k => `${k}: ${p.nudgeStats[k].fired}×`).join(", ")}`);
    }

    lines.push("");
    lines.push(pc.dim(`  Use --json for raw data, --reset to start fresh`));

    return { handled: true, output: lines.join("\n") };
  }
  if (action === "summary") {
    try {
      const identity = await acoreGetIdentity(AGENT_SCOPE);
      if (!identity) return { handled: true, output: pc.yellow("No identity configured.") };
      const nameMatch = identity.content.match(/\*\*Name:\*\*\s*(.+)/);
      const lines = [
        `**Identity Summary**`,
        nameMatch ? `Name: ${nameMatch[1].trim()}` : "",
        `Scope: ${AGENT_SCOPE}`,
      ].filter(Boolean);
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Summary error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "help") {
    return {
      handled: true,
      output: [
        pc.bold("Identity commands:"),
        `  ${pc.cyan("/identity")}                  View current identity`,
        `  ${pc.cyan("/identity update")} <section>  Update a section`,
        `  ${pc.cyan("/identity dynamics")}           View user model (trust, sentiment, patterns)`,
        `  ${pc.cyan("/identity dynamics")} key=val   Update dynamic fields (energy, mode, read)`,
        `  ${pc.cyan("/identity dynamics")} --json    Raw JSON user model`,
        `  ${pc.cyan("/identity dynamics")} --reset   Reset user model`,
        `  ${pc.cyan("/identity summary")}            Show structured identity summary`,
      ].join("\n"),
    };
  }
  return {
    handled: true,
    output: pc.yellow(
      `Unknown action: /identity ${action}. Try /identity --help`,
    ),
  };
}

async function handleRulesCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    const cats = await arulesListCategories(AGENT_SCOPE);
    if (cats.length === 0) {
      return {
        handled: true,
        output: pc.dim(
          `No rules configured for ${AGENT_SCOPE}. Run: npx @aman_asmuei/arules`,
        ),
      };
    }
    const lines: string[] = [];
    for (const cat of cats) {
      lines.push(pc.bold(`## ${cat.name}`));
      for (const rule of cat.rules) {
        lines.push(`  - ${rule}`);
      }
      lines.push("");
    }
    return { handled: true, output: lines.join("\n").trim() };
  }
  if (action === "add") {
    if (args.length < 2) {
      return {
        handled: true,
        output: pc.yellow("Usage: /rules add <category> <rule text...>"),
      };
    }
    const category = args[0];
    const rule = args.slice(1).join(" ");
    try {
      await arulesAddRule(category, rule, AGENT_SCOPE);
      return {
        handled: true,
        output: pc.green(`Added rule to "${category}": ${rule}`),
      };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
  if (action === "remove") {
    if (args.length < 2) {
      return {
        handled: true,
        output: pc.yellow("Usage: /rules remove <category> <index>"),
      };
    }
    const category = args[0];
    const idx = parseInt(args[1], 10);
    if (isNaN(idx) || idx < 1) {
      return {
        handled: true,
        output: pc.yellow("Index must be a positive integer."),
      };
    }
    try {
      await arulesRemoveRule(category, idx, AGENT_SCOPE);
      return {
        handled: true,
        output: pc.green(`Removed rule ${idx} from "${category}"`),
      };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
  if (action === "toggle") {
    if (args.length < 2) {
      return {
        handled: true,
        output: pc.yellow("Usage: /rules toggle <category> <index>"),
      };
    }
    const category = args[0];
    const idx = parseInt(args[1], 10);
    if (isNaN(idx) || idx < 1) {
      return {
        handled: true,
        output: pc.yellow("Index must be a positive integer."),
      };
    }
    try {
      await arulesToggleRule(category, idx, AGENT_SCOPE);
      return {
        handled: true,
        output: pc.green(`Toggled rule ${idx} in "${category}"`),
      };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
  if (action === "check") {
    if (args.length === 0) {
      return { handled: true, output: pc.yellow("Usage: /rules check <action description...>") };
    }
    const description = args.join(" ");
    try {
      const result = await arulesCheckAction(description, AGENT_SCOPE);
      if (result.safe) {
        return { handled: true, output: pc.green(`Action is allowed: "${description}"`) };
      }
      return {
        handled: true,
        output: pc.red(`Action blocked: "${description}"\nViolations:\n${result.violations.map(v => `  - ${v}`).join("\n")}`),
      };
    } catch (err) {
      return { handled: true, output: pc.red(`Check error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "help") {
    return {
      handled: true,
      output: [
        pc.bold("Rules commands:"),
        `  ${pc.cyan("/rules")}                         View current rules`,
        `  ${pc.cyan("/rules add")} <category> <text>    Add a rule`,
        `  ${pc.cyan("/rules remove")} <category> <idx>  Remove a rule`,
        `  ${pc.cyan("/rules toggle")} <category> <idx>  Toggle a rule`,
        `  ${pc.cyan("/rules check")} <action...>         Check if an action is allowed`,
      ].join("\n"),
    };
  }
  return {
    handled: true,
    output: pc.yellow(`Unknown action: /rules ${action}. Try /rules --help`),
  };
}

async function handleWorkflowsCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".aflow", "flow.md"), "workflows (aflow)");
    return { handled: true, output: content };
  }
  if (action === "add") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /workflows add <name>") };
    }
    const output = await mcpWrite(ctx, "workflows", "workflow_add", { name: args.join(" ") });
    return { handled: true, output };
  }
  if (action === "remove") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /workflows remove <name>") };
    }
    const output = await mcpWrite(ctx, "workflows", "workflow_remove", { name: args.join(" ") });
    return { handled: true, output };
  }
  if (action === "get") {
    if (args.length === 0) {
      return { handled: true, output: pc.yellow("Usage: /workflows get <name>") };
    }
    const name = args.join(" ").toLowerCase();
    const raw = readEcosystemFile(path.join(home, ".aflow", "flow.md"), "workflows (aflow)");
    if (raw.startsWith("No ")) {
      return { handled: true, output: raw };
    }
    // Parse sections: ## WorkflowName\n<steps>
    const sections = raw.split(/^## /m).slice(1);
    const match = sections.find(s => s.split("\n")[0].trim().toLowerCase() === name);
    if (!match) {
      return { handled: true, output: pc.yellow(`No workflow found: "${args.join(" ")}"`) };
    }
    const title = match.split("\n")[0].trim();
    const body = match.split("\n").slice(1).join("\n").trim();
    return { handled: true, output: `## ${title}\n\n${body}` };
  }
  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Workflow commands:"),
      `  ${pc.cyan("/workflows")}              View current workflows`,
      `  ${pc.cyan("/workflows add")} <name>    Add a workflow`,
      `  ${pc.cyan("/workflows remove")} <name> Remove a workflow`,
      `  ${pc.cyan("/workflows get")} <name>    Show a specific workflow`,
    ].join("\n") };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /workflows ${action}. Try /workflows --help`) };
}

// ── /akit slash command — Phase 5 cleanup ───────────────────────────────────
//
// The hardcoded AKIT_REGISTRY (17 entries kept "in sync" with akit's own
// registry by hand), the AkitTool/InstalledTool interfaces, and the
// loadAkitInstalled / saveAkitInstalled / addToAmanAgentConfig /
// removeFromAmanAgentConfig helpers all lived here in commands.ts. They were
// a parallel implementation of `akit/src/lib/registry.ts` and `lib/kit.ts`,
// flagged by the Phase 0 audit as the worst duplication site in aman-agent.
//
// Per engine v1 D4: akit is reclassified as DORMANT — it stays as the
// standalone CLI tool installer, and aman-agent no longer reimplements its
// registry. This /akit slash command becomes informational, pointing the
// user at the canonical CLI.

function handleAkitCommand(
  _action: string | undefined,
  _args: string[],
): CommandResult {
  return {
    handled: true,
    output: [
      pc.bold("akit — Tool Management"),
      "",
      pc.dim(
        "Tool management is now handled by the standalone akit CLI rather than",
      ),
      pc.dim(
        "duplicated inside aman-agent. The akit slash command is informational only.",
      ),
      "",
      `  ${pc.cyan("npx @aman_asmuei/akit list")}              List installed tools`,
      `  ${pc.cyan("npx @aman_asmuei/akit search <query>")}    Search the tool registry`,
      `  ${pc.cyan("npx @aman_asmuei/akit add <tool>")}        Install a tool`,
      `  ${pc.cyan("npx @aman_asmuei/akit remove <tool>")}     Uninstall a tool`,
      "",
      pc.dim(
        "Restart aman-agent after installing/removing tools to pick up changes.",
      ),
    ].join("\n"),
  };
}

async function handleToolsCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action || action === "list") {
    // Informational stub — actual tool management is via akit CLI
    return handleAkitCommand(action, args);
  }
  if (action === "search") {
    if (args.length === 0) {
      return { handled: true, output: pc.yellow("Usage: /tools search <query...>") };
    }
    const query = args.join(" ").toLowerCase();
    const home = os.homedir();
    const toolsFile = path.join(home, ".akit", "tools.md");
    if (!fs.existsSync(toolsFile)) {
      return { handled: true, output: pc.dim(`No tools file found. Use 'npx @aman_asmuei/akit search ${args.join(" ")}' to search the registry.`) };
    }
    const raw = fs.readFileSync(toolsFile, "utf-8").trim();
    const lines = raw.split("\n");
    const matches = lines.filter(l => l.toLowerCase().includes(query));
    if (matches.length === 0) {
      return { handled: true, output: pc.dim(`No tools matching "${query}".`) };
    }
    return { handled: true, output: [pc.bold(`Tools matching "${query}":`), ...matches].join("\n") };
  }
  return handleAkitCommand(action, args);
}

async function handleSkillsCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".askill", "skills.md"), "skills (askill)");
    return { handled: true, output: content };
  }
  if (action === "install") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /skills install <name>") };
    }
    const output = await mcpWrite(ctx, "skills", "skill_install", { name: args.join(" ") });
    return { handled: true, output };
  }
  if (action === "uninstall") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /skills uninstall <name>") };
    }
    const output = await mcpWrite(ctx, "skills", "skill_uninstall", { name: args.join(" ") });
    return { handled: true, output };
  }
  if (action === "search") {
    if (args.length === 0) {
      return { handled: true, output: pc.yellow("Usage: /skills search <query...>") };
    }
    const query = args.join(" ").toLowerCase();
    const home = os.homedir();
    const raw = readEcosystemFile(path.join(home, ".askill", "skills.md"), "skills (askill)");
    if (raw.startsWith("No ")) {
      return { handled: true, output: raw };
    }
    const lines = raw.split("\n");
    const matches = lines.filter(l => l.toLowerCase().includes(query));
    if (matches.length === 0) {
      return { handled: true, output: pc.dim(`No skills matching "${query}".`) };
    }
    return { handled: true, output: [pc.bold(`Skills matching "${query}":`), ...matches].join("\n") };
  }
  if (action === "list") {
    const autoOnly = args.includes("--auto");
    if (autoOnly) {
      const logPath = path.join(os.homedir(), ".aman-agent", "crystallization-log.json");
      try {
        const content = fs.readFileSync(logPath, "utf-8");
        const entries = JSON.parse(content) as Array<{
          name: string;
          createdAt: string;
          fromPostmortem: string;
          confidence: number;
          triggers: string[];
        }>;
        if (entries.length === 0) {
          return { handled: true, output: pc.dim("No crystallized skills yet.") };
        }
        const suggestionsPath = path.join(os.homedir(), ".aman-agent", "crystallization-suggestions.json");
        let sugCounts: Record<string, number> = {};
        try {
          const sc = fs.readFileSync(suggestionsPath, "utf-8");
          sugCounts = JSON.parse(sc);
        } catch { /* noop */ }

        // Count archived versions per skill from skills.md
        let versionCounts: Record<string, number> = {};
        try {
          const skillsContent = fs.readFileSync(path.join(os.homedir(), ".askill", "skills.md"), "utf-8");
          const versionRe = /^# (.+)\.v(\d+)$/gm;
          let vMatch;
          while ((vMatch = versionRe.exec(skillsContent)) !== null) {
            const skillHeading = vMatch[1].toLowerCase().replace(/ /g, "-");
            const ver = parseInt(vMatch[2], 10);
            versionCounts[skillHeading] = Math.max(versionCounts[skillHeading] || 0, ver);
          }
        } catch { /* noop */ }

        const lines = [pc.bold(`Crystallized skills (${entries.length}):`)];
        for (const entry of entries) {
          const date = entry.createdAt.slice(0, 10);
          const count = sugCounts[entry.name];
          const reinforced = count && count >= 3 ? pc.green(` ★ reinforced (${count}×)`) : "";
          const versions = versionCounts[entry.name];
          const versionLabel = versions ? pc.dim(` [v${versions + 1}]`) : "";
          lines.push(`  ${pc.cyan(entry.name)} (${date}, conf ${entry.confidence})${reinforced}${versionLabel}`);
          lines.push(pc.dim(`    triggers: ${entry.triggers.join(", ")}`));
        }
        return { handled: true, output: lines.join("\n") };
      } catch {
        return { handled: true, output: pc.dim("No crystallized skills yet.") };
      }
    }
    const content = readEcosystemFile(path.join(home, ".askill", "skills.md"), "skills (askill)");
    return { handled: true, output: content };
  }
  if (action === "crystallize") {
    const pmDir = path.join(os.homedir(), ".acore", "postmortems");
    try {
      const files = fs.readdirSync(pmDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
      if (jsonFiles.length === 0) {
        return {
          handled: true,
          output: pc.dim("No post-mortems found. Run a session that triggers a post-mortem first."),
        };
      }
      const latest = jsonFiles[0];
      const content = fs.readFileSync(path.join(pmDir, latest), "utf-8");
      const report = JSON.parse(content);
      if (
        !report.crystallizationCandidates ||
        report.crystallizationCandidates.length === 0
      ) {
        return {
          handled: true,
          output: pc.dim(`No crystallization candidates in the most recent post-mortem (${latest}). Run a longer session or wait for the next auto-postmortem.`),
        };
      }

      const skillsMdPath = path.join(os.homedir(), ".askill", "skills.md");
      const logPath = path.join(os.homedir(), ".aman-agent", "crystallization-log.json");
      const postmortemFilename = latest.replace(/\.json$/, ".md");

      const lines: string[] = [
        pc.bold(`Found ${report.crystallizationCandidates.length} candidate(s) in ${latest}:`),
      ];
      let written = 0;
      for (const raw of report.crystallizationCandidates) {
        const candidate = validateCandidate(raw);
        if (!candidate) {
          const rawName = (raw as { name?: string }).name ?? "unknown";
          lines.push(pc.dim(`  ⊘ ${rawName} — failed validation`));
          continue;
        }
        const result = await writeSkillToFile(candidate, skillsMdPath, postmortemFilename);
        if (result.written) {
          written++;
          lines.push(pc.green(`  ✓ Crystallized: ${candidate.name}`));
          await appendCrystallizationLog(
            {
              name: candidate.name,
              createdAt: new Date().toISOString(),
              fromPostmortem: postmortemFilename,
              confidence: candidate.confidence,
              triggers: candidate.triggers,
            },
            logPath,
          );
        } else {
          lines.push(pc.yellow(`  ⊘ ${candidate.name} — ${result.reason}`));
        }
      }

      if (written > 0) {
        lines.push("");
        lines.push(pc.dim(`Crystallized skills will auto-activate in your next session.`));
      }

      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(`Failed to load post-mortems: ${err instanceof Error ? err.message : String(err)}`),
      };
    }
  }
  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Skills commands:"),
      `  ${pc.cyan("/skills")}                      View installed skills`,
      `  ${pc.cyan("/skills install")} <name>        Install a skill`,
      `  ${pc.cyan("/skills uninstall")} <name>      Uninstall a skill`,
      `  ${pc.cyan("/skills search")} <query>         Search skills by name/description`,
      `  ${pc.cyan("/skills crystallize")}            Crystallize skills from most recent post-mortem`,
      `  ${pc.cyan("/skills list --auto")}            List crystallized (auto-created) skills`,
    ].join("\n") };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /skills ${action}. Try /skills --help`) };
}

async function handleEvalCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".aeval", "eval.md"), "evaluation (aeval)");
    return { handled: true, output: content };
  }
  if (action === "milestone") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /eval milestone <text...>") };
    }
    const text = args.join(" ");
    const output = await mcpWrite(ctx, "eval", "eval_milestone", { text });
    return { handled: true, output };
  }
  if (action === "report") {
    const evalFile = path.join(home, ".aeval", "eval.md");
    const lines: string[] = [pc.bold("📊 Eval Report")];

    // Raw eval log
    if (fs.existsSync(evalFile)) {
      lines.push("", fs.readFileSync(evalFile, "utf-8").trim());
    } else {
      lines.push("", pc.dim("No eval log yet. Use /eval milestone <text> to start."));
    }

    // Analytics from user model
    try {
      const model = await loadUserModel();
      if (model && model.sessions.length >= 3) {
        const profile = computeProfile(model.sessions, model.profile.totalSessions);
        const burnout = predictBurnout(model.sessions);
        lines.push("", pc.bold("── Analytics ──"));
        lines.push(`  Sessions tracked: ${pc.cyan(String(profile.totalSessions))}`);
        lines.push(`  Trust score:      ${pc.cyan(profile.trustScore.toFixed(2))}`);
        lines.push(`  Sentiment trend:  ${pc.cyan(profile.sentimentTrend)}`);

        // Energy distribution
        const topEnergy = Object.entries(profile.energyDistribution)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`);
        lines.push(`  Top energy:       ${pc.cyan(topEnergy.join(", "))}`);

        // Burnout
        const riskColor = burnout.risk > 0.7 ? pc.red : burnout.risk > 0.4 ? pc.yellow : pc.green;
        lines.push(`  Burnout risk:     ${riskColor((burnout.risk * 100).toFixed(0) + "%")} ${burnout.factors.length > 0 ? pc.dim("(" + burnout.factors.join(", ") + ")") : ""}`);

        // Frustration correlations
        const cors = Object.entries(profile.frustrationCorrelations)
          .filter(([, v]) => Math.abs(v) > 0.3)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 3);
        if (cors.length > 0) {
          lines.push(`  Frustration corr: ${cors.map(([k, v]) => `${k} ${v > 0 ? "↑" : "↓"}${Math.abs(v).toFixed(2)}`).join(", ")}`);
        }
      }
    } catch {
      // User model unavailable — skip analytics silently
    }

    // Background task history
    try {
      const taskLog = loadTaskLog();
      if (taskLog.length > 0) {
        const completed = taskLog.filter((t) => t.status === "completed").length;
        const failed = taskLog.filter((t) => t.status === "failed").length;
        const interrupted = taskLog.filter((t) => t.status === "interrupted").length;
        lines.push("", pc.bold("── Background Tasks ──"));
        lines.push(`  Total: ${taskLog.length}  ✅ ${completed}  ❌ ${failed}  ⚠️ ${interrupted}`);
      }
    } catch {
      // Task log unavailable — skip
    }

    return { handled: true, output: lines.join("\n") };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /eval ${action}. Use /eval, /eval report, or /eval milestone <text>.`) };
}

async function handleMemoryCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    // Default: show recent memory context
    try {
      const result = await memoryContext("recent context");
      if (result.memoriesUsed === 0) {
        return { handled: true, output: pc.dim("No memories yet. Start chatting and I'll remember what matters.") };
      }
      return { handled: true, output: result.text };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  // /memory <topic> — shortcut for context on a specific topic
  if (action && !["search", "clear", "timeline", "stats", "export", "since", "fts", "help", "doctor", "repair", "config", "reflect", "consolidate", "tier", "detail", "relate", "expire", "versions", "sync", "mirror"].includes(action)) {
    try {
      const topic = [action, ...args].join(" ");
      const result = await memoryContext(topic);
      if (result.memoriesUsed === 0) {
        return { handled: true, output: pc.dim(`No memories found for: "${topic}".`) };
      }
      return { handled: true, output: result.text };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "search") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory search <query...>") };
    }
    const query = args.join(" ");
    try {
      const result = await memoryMultiRecall(query, { limit: 10 });
      if (result.total === 0) {
        return { handled: true, output: pc.dim("No memories found.") };
      }
      const header = `Search results for "${query}" (${result.total}):`;
      const lines: string[] = [pc.bold(header), ""];
      for (const m of result.memories) {
        const tags = m.tags?.length > 0
          ? ` ${pc.dim(m.tags.map((t: string) => `#${t}`).join(" "))}`
          : "";
        lines.push(`  [${m.type}] ${m.content}${tags}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "clear") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory clear <query>  — delete memories matching a search query\n       /memory clear --type <type>  — delete all memories of a type (correction|decision|pattern|preference|topology|fact)") };
    }
    try {
      // Support --type <type> for category-based delete
      if (args[0] === "--type" && args[1]) {
        const result = await memoryForget({ type: args[1] });
        return { handled: true, output: result.deleted > 0 ? pc.green(result.message) : pc.dim(result.message) };
      }
      const result = await memoryForget({ query: args.join(" ") });
      return { handled: true, output: result.deleted > 0 ? pc.green(result.message) : pc.dim(result.message) };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "timeline") {
    try {
      const result = await memoryRecall("*", { limit: 500, compact: false });
      if (result.total === 0) {
        return { handled: true, output: pc.dim("No memories yet. Start chatting and I'll remember what matters.") };
      }
      const memories = result.memories;
      if (memories.length > 0) {
        const byDate = new Map<string, number>();
        for (const mem of memories) {
          const createdAt = (mem as { created_at?: number }).created_at;
          const date = createdAt
            ? new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Unknown";
          byDate.set(date, (byDate.get(date) || 0) + 1);
        }
        const maxCount = Math.max(...byDate.values());
        const barWidth = 10;
        const lines: string[] = [pc.bold("Memory Timeline:"), ""];
        for (const [date, count] of byDate) {
          const filled = Math.round((count / maxCount) * barWidth);
          const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
          lines.push(`  ${date.padEnd(8)} ${bar}  ${count} memories`);
        }
        const tags = new Map<string, number>();
        for (const mem of memories) {
          const memTags = (mem as { tags?: string[] }).tags;
          if (Array.isArray(memTags)) {
            for (const tag of memTags) {
              tags.set(tag, (tags.get(tag) || 0) + 1);
            }
          }
        }
        lines.push("");
        lines.push(`  Total: ${result.total} memories`);
        if (tags.size > 0) {
          const topTags = [...tags.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag, count]) => `#${tag} (${count})`)
            .join(", ");
          lines.push(`  Top tags: ${topTags}`);
        }
        return { handled: true, output: lines.join("\n") };
      }
      return { handled: true, output: `Total memories: ${result.total} entries.` };
    } catch {
      return { handled: true, output: pc.red("Failed to retrieve memory timeline.") };
    }
  }
  if (action === "stats") {
    try {
      const stats = memoryStats();
      const lines: string[] = [pc.bold("Memory Statistics:"), ""];
      lines.push(`  Total memories: ${pc.bold(String(stats.total))}`);
      if (Object.keys(stats.byType).length > 0) {
        lines.push("");
        lines.push(`  ${pc.dim("By type:")}`);
        for (const [type, count] of Object.entries(stats.byType)) {
          lines.push(`    ${type.padEnd(16)} ${count}`);
        }
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "export") {
    try {
      // `--to <dir>` / `--to=<dir>` → one-shot snapshot via MirrorEngine.
      // Left of any legacy stdout-dump behaviour unchanged so existing
      // callers of `/memory export [json]` keep working.
      const toDir = parseFlagValue(args, "--to");
      if (toDir !== undefined) {
        const engine = getMirrorEngine();
        if (!engine) {
          return { handled: true, output: pc.yellow("Mirror is disabled — enable via config.mirror.enabled in config.json.") };
        }
        const resolved = expandHome(toDir);
        const res = await engine.exportSnapshot(resolved);
        const lines = [
          `Wrote ${res.written} files to ${resolved} (${res.skipped} skipped, ${res.errors.length} errors).`,
        ];
        if (res.errors.length > 0) {
          lines.push("");
          for (const e of res.errors.slice(0, 5)) lines.push(`  - ${e}`);
          if (res.errors.length > 5) lines.push(`  ...and ${res.errors.length - 5} more`);
        }
        return { handled: true, output: lines.join("\n") };
      }
      const format = args[0] === "json" ? "json" : "markdown";
      const memories = memoryExport();
      if (memories.length === 0) {
        return { handled: true, output: pc.dim("No memories to export.") };
      }
      if (format === "json") {
        const jsonOut = memories.map(m => ({ id: m.id, type: m.type, content: m.content, tags: m.tags, confidence: m.confidence, createdAt: m.createdAt, tier: m.tier }));
        return { handled: true, output: JSON.stringify(jsonOut, null, 2) };
      }
      const lines: string[] = [`# Memory Export (${memories.length} memories)`, ""];
      for (const m of memories) {
        const date = new Date(m.createdAt).toLocaleDateString();
        const tags = m.tags.length > 0 ? ` [${m.tags.map(t => `#${t}`).join(", ")}]` : "";
        lines.push(`- **[${m.type}]** ${m.content}${tags} ${pc.dim(`(${date}, ${Math.round(m.confidence * 100)}%)`)}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "since") {
    try {
      let hours = 24;
      if (args[0]) {
        const match = args[0].match(/^(\d+)(h|d|w)$/);
        if (match) {
          const value = parseInt(match[1], 10);
          const unit = match[2];
          if (unit === "h") hours = value;
          else if (unit === "d") hours = value * 24;
          else if (unit === "w") hours = value * 24 * 7;
        } else {
          return { handled: true, output: pc.yellow("Usage: /memory since <Nh|Nd|Nw>  (e.g., 24h, 7d, 1w)") };
        }
      }
      const memories = memorySince(hours);
      if (memories.length === 0) {
        return { handled: true, output: pc.dim(`No memories in the last ${args[0] || "24h"}.`) };
      }
      const lines: string[] = [pc.bold(`Memories since ${args[0] || "24h"} (${memories.length}):`), ""];
      for (const m of memories) {
        const age = Math.round((Date.now() - m.createdAt) / 3600000);
        const ageStr = age < 1 ? "<1h ago" : `${age}h ago`;
        lines.push(`  ${pc.dim(ageStr.padEnd(10))} [${m.type}] ${m.content}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "fts") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory fts <query...>  — full-text search") };
    }
    try {
      const query = args.join(" ");
      const results = memorySearch(query, 20);
      if (results.length === 0) {
        return { handled: true, output: pc.dim(`No results for full-text search: "${query}".`) };
      }
      const lines: string[] = [pc.bold(`FTS results for "${query}" (${results.length}):`), ""];
      for (const m of results) {
        const tags = m.tags.length > 0 ? ` ${pc.dim(m.tags.map(t => `#${t}`).join(" "))}` : "";
        lines.push(`  [${m.type}] ${m.content}${tags}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Memory commands:"),
      `  ${pc.cyan("/memory")}                    View recent context`,
      `  ${pc.cyan("/memory")} <topic>             Context for a topic`,
      `  ${pc.cyan("/memory search")} <query>      Search memories (semantic)`,
      `  ${pc.cyan("/memory fts")} <query>          Full-text search (FTS5)`,
      `  ${pc.cyan("/memory since")} <Nh|Nd|Nw>    Memories from time window`,
      `  ${pc.cyan("/memory stats")}               Show memory statistics`,
      `  ${pc.cyan("/memory export")} [json]        Export all memories`,
      `  ${pc.cyan("/memory export --to")} <dir>    Snapshot mirror-format files to <dir>`,
      `  ${pc.cyan("/memory timeline")}            View memory timeline`,
      `  ${pc.cyan("/memory clear")} <query>        Delete matching memories`,
      `  ${pc.cyan("/memory clear --type")} <type>  Delete all of a type`,
      `  ${pc.cyan("/memory doctor")}              Run memory diagnostics`,
      `  ${pc.cyan("/memory repair")}              Dry-run repair (safe)`,
      `  ${pc.cyan("/memory config")} [key=value]  View or update config (e.g. consolidation.maxStaleDays=60)`,
      `  ${pc.cyan("/memory mirror status")}        Show mirror dir, file count, health`,
      `  ${pc.cyan("/memory mirror rebuild")}       Rebuild the mirror from the DB`,
      `  ${pc.cyan("/memory sync --from")} <dir>    Import edits from a mirror-format dir`,
    ].join("\n") };
  }
  if (action === "doctor") {
    try {
      const diag = await memoryDoctor();
      const statusIcon = diag.status === "healthy" ? "✅" : "⚠️";
      const lines: string[] = [
        `**Memory Diagnostics**`,
        `Status: ${statusIcon} ${diag.status}`,
      ];
      if (diag.issues?.length) {
        lines.push("", "**Issues:**");
        for (const issue of diag.issues) {
          lines.push(`- ${typeof issue === "string" ? issue : (issue as { message?: string }).message ?? String(issue)}`);
        }
        lines.push("", "_Run `/memory repair` (dry-run) or `/memory repair --apply` to fix._");
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory doctor error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "repair") {
    try {
      const dryRun = !args.includes("--apply");
      const result = await memoryRepair({ dryRun });
      const prefix = dryRun ? "[DRY RUN] " : "";
      const lines: string[] = [`**${prefix}Memory Repair**`];
      if (result.actions?.length) {
        lines.push("", "**Actions:**");
        for (const act of result.actions) {
          lines.push(`- ${act}`);
        }
      } else {
        lines.push("No actions needed.");
      }
      if (dryRun) {
        lines.push("", "_Run `/memory repair --apply` to execute._");
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory repair error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "config") {
    try {
      const kvArg = args.find((a: string) => a.includes("=") && !a.startsWith("-"));
      if (kvArg) {
        const eqIdx = kvArg.indexOf("=");
        const key = kvArg.slice(0, eqIdx);
        const rawVal = kvArg.slice(eqIdx + 1);
        if (!rawVal) {
          return { handled: true, output: pc.yellow(`Usage: /memory config <key>=<value>`) };
        }
        const val = isNaN(Number(rawVal)) ? rawVal : Number(rawVal);
        const update = buildNestedUpdate(key, val);
        await memoryConfig(update);
        return { handled: true, output: `✅ Set \`${key}\` → \`${val}\`` };
      }
      const config = await memoryConfig();
      const lines = ["**Memory Config**", "```"];
      for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
        if (typeof v === "object" && v !== null) {
          for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
            lines.push(`${k}.${sk}: ${sv}`);
          }
        } else {
          lines.push(`${k}: ${v}`);
        }
      }
      lines.push("```", "", "_Use `/memory config key=value` to change a setting._");
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory config error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "reflect") {
    try {
      const report = await memoryReflect();
      const lines = [
        pc.bold("Reflection complete"),
        `Clusters: ${report.clusters.length}`,
        `Contradictions: ${report.contradictions.length}`,
        `Synthesis candidates: ${report.synthesisCandidates.length}`,
        `Knowledge gaps: ${report.knowledgeGaps.length}`,
        `Health score: ${(report.stats.healthScore * 100).toFixed(0)}%`,
        `Duration: ${report.durationMs}ms`,
      ];
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reflect error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "consolidate") {
    const apply = args.includes("--apply");
    try {
      const report = memoryConsolidate(!apply);
      const lines = [
        apply ? pc.bold("Consolidation applied") : pc.bold("Consolidation dry-run"),
        `Merged: ${report.merged}`,
        `Pruned: ${report.pruned}`,
        `Promoted: ${report.promoted}`,
        `Decayed: ${report.decayed}`,
        `Health score: ${(report.healthScore * 100).toFixed(0)}%`,
        `Before: ${report.before.total} → After: ${report.after.total}`,
      ];
      if (!apply) lines.push(pc.dim("Run with --apply to execute."));
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Consolidate error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "tier") {
    const id = args[0];
    const tier = args[1];
    if (!id || !tier) {
      return { handled: true, output: pc.yellow("Usage: /memory tier <id> <core|working|archival>") };
    }
    const tierResult = memoryTier(id, tier);
    if (!tierResult.ok) {
      return { handled: true, output: pc.red(`Tier error: ${tierResult.error}`) };
    }
    return { handled: true, output: `✅ Memory ${tierResult.id} moved to tier: ${tierResult.tier}` };
  }
  if (action === "detail") {
    const id = args[0];
    if (!id) {
      return { handled: true, output: pc.yellow("Usage: /memory detail <id>") };
    }
    const memory = memoryDetail(id);
    if (!memory) {
      return { handled: true, output: pc.dim(`Memory not found: ${id}`) };
    }
    const lines = [
      pc.bold(`Memory: ${memory.id}`),
      `Content: ${memory.content}`,
      `Type: ${memory.type}`,
      `Confidence: ${memory.confidence}`,
      `Tier: ${(memory as any).tier ?? "working"}`,
      `Access count: ${memory.accessCount}`,
      `Created: ${new Date(memory.createdAt).toISOString()}`,
      memory.tags?.length ? `Tags: ${memory.tags.join(", ")}` : "",
    ].filter(Boolean);
    return { handled: true, output: lines.join("\n") };
  }
  if (action === "relate") {
    const [fromId, toId, relType, strengthStr] = args;
    if (!fromId || !toId || !relType) {
      return { handled: true, output: pc.yellow("Usage: /memory relate <fromId> <toId> <type> [strength]") };
    }
    const strength = strengthStr !== undefined ? parseFloat(strengthStr) : undefined;
    const relResult = memoryRelate(fromId, toId, relType, strength);
    if (!relResult.ok) {
      return { handled: true, output: pc.red(`Relate error: ${relResult.error}`) };
    }
    return { handled: true, output: `✅ Relation created: ${fromId} --[${relType}]--> ${toId} (id: ${relResult.relationId})` };
  }
  if (action === "expire") {
    const id = args[0];
    if (!id) {
      return { handled: true, output: pc.yellow("Usage: /memory expire <id> [reason]") };
    }
    const reason = args.slice(1).join(" ") || undefined;
    const expireResult = memoryExpire(id, reason);
    if (!expireResult.ok) {
      return { handled: true, output: pc.red(`Expire error: ${expireResult.error}`) };
    }
    return { handled: true, output: `✅ Memory ${expireResult.id} expired${reason ? `: ${reason}` : ""}` };
  }
  if (action === "versions") {
    const id = args[0];
    if (!id) {
      return { handled: true, output: pc.yellow("Usage: /memory versions <id>") };
    }
    const versions = memoryVersions(id);
    if (!versions.length) {
      return { handled: true, output: pc.dim(`No version history for: ${id}`) };
    }
    const lines = [pc.bold(`Version history for ${id}:`)];
    for (const v of versions) {
      lines.push(`  [${new Date(v.editedAt).toISOString()}] ${v.content.slice(0, 80)}${v.content.length > 80 ? "\u2026" : ""}`);
    }
    return { handled: true, output: lines.join("\n") };
  }
  if (action === "mirror") {
    const sub = args[0];
    try {
      if (sub === "status") {
        const engine = getMirrorEngine();
        if (!engine) return { handled: true, output: pc.yellow("Mirror is disabled.") };
        const s = engine.status();
        const last = s.lastWriteAt
          ? `${new Date(s.lastWriteAt).toISOString()} (${relativeTimeFromNow(s.lastWriteAt)})`
          : "never";
        const lines = [
          pc.bold("Mirror:"),
          `  Dir:          ${s.dir}`,
          `  File count:   ${s.fileCount}`,
          `  Last write:   ${last}`,
          `  Health:       ${s.healthy ? "healthy" : "drifted"}`,
        ];
        return { handled: true, output: lines.join("\n") };
      }
      if (sub === "rebuild") {
        const engine = getMirrorEngine();
        if (!engine) return { handled: true, output: pc.yellow("Mirror is disabled.") };
        const res = await engine.fullMirror();
        return {
          handled: true,
          output: `Rebuilt mirror: ${res.written} files written, ${res.skipped} skipped, ${res.errors.length} errors.`,
        };
      }
      return { handled: true, output: pc.yellow("Unknown mirror subcommand; try 'status' or 'rebuild'.") };
    } catch (err) {
      return { handled: true, output: pc.red(`Mirror error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "sync") {
    // `--from <dir>` / `--from=<dir>` → import mirror-format files into the DB.
    // This is the recovery path for the multi-device sync loop: a machine
    // that lost its DB but kept the markdown mirror can reconstruct state.
    const fromDir = parseFlagValue(args, "--from");
    if (fromDir !== undefined) {
      try {
        const resolved = expandHome(fromDir);
        const res = await syncFromMirrorDir(resolved);
        return {
          handled: true,
          output: `Synced ${res.imported} memories from ${resolved} (${res.skipped} skipped, ${res.updated} updated).`,
        };
      } catch (err) {
        return { handled: true, output: pc.red(`Sync error: ${err instanceof Error ? err.message : String(err)}`) };
      }
    }
    const syncAction = args[0] as "import-claude" | "export-team" | "import-team" | "sync-copilot" | undefined;
    if (!syncAction) {
      return { handled: true, output: pc.yellow("Usage: /memory sync <import-claude|export-team|import-team|sync-copilot>") };
    }
    try {
      const opts: Record<string, string | boolean | undefined> = {};
      for (const arg of args.slice(1)) {
        if (arg.startsWith("--")) {
          const [k, v] = arg.slice(2).split("=");
          opts[k] = v ?? true;
        }
      }
      const result = await memorySync(syncAction, opts as any);
      return { handled: true, output: `✅ Sync [${syncAction}] complete:\n${JSON.stringify(result, null, 2)}` };
    } catch (err) {
      return { handled: true, output: pc.red(`Sync error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  return { handled: true, output: pc.yellow(`Unknown action: /memory ${action}. Try /memory --help`) };
}

/**
 * Parse `--flag <value>` and `--flag=<value>` forms from an argv-like list.
 * Returns `undefined` when the flag isn't present so callers can distinguish
 * "flag absent" from "flag with empty value". Shared by `/memory export --to`
 * and `/memory sync --from` to keep their arg-parsing consistent.
 */
function parseFlagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag) {
      return args[i + 1];
    }
    if (a.startsWith(`${flag}=`)) {
      return a.slice(flag.length + 1);
    }
  }
  return undefined;
}

/**
 * Tiny relative-time formatter for mirror status. Stays local to commands.ts
 * because mirror status is its only caller — no need to add a helper module.
 */
function relativeTimeFromNow(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

function handleStatusCommand(ctx: CommandContext): CommandResult {
  const mcpToolCount = ctx.mcpManager ? ctx.mcpManager.getTools().length : 0;
  const amemConnected = isMemoryInitialized();
  const status = getEcosystemStatus(mcpToolCount, amemConnected);

  const lines: string[] = [pc.bold("Aman Ecosystem Dashboard"), ""];

  for (const layer of status.layers) {
    const icon = layer.exists ? pc.green("●") : pc.dim("○");
    const name = pc.bold(layer.name.padEnd(12));
    const summary = layer.exists ? layer.summary : pc.dim("not configured");
    lines.push(`  ${icon} ${name} ${summary}`);
  }

  lines.push("");
  lines.push(`  ${status.mcpConnected ? pc.green("●") : pc.dim("○")} ${pc.bold("MCP".padEnd(12))} ${status.mcpConnected ? `${status.mcpToolCount} tools available` : pc.dim("not connected")}`);
  lines.push(`  ${status.amemConnected ? pc.green("●") : pc.dim("○")} ${pc.bold("Memory".padEnd(12))} ${status.amemConnected ? "connected" : pc.dim("not connected")}`);

  return { handled: true, output: lines.join("\n") };
}

function handleDoctorCommand(ctx: CommandContext): CommandResult {
  const mcpToolCount = ctx.mcpManager ? ctx.mcpManager.getTools().length : 0;
  const amemConnected = isMemoryInitialized();
  const status = getEcosystemStatus(mcpToolCount, amemConnected);

  const lines: string[] = [pc.bold("Aman Health Check"), ""];
  let healthy = 0;
  let fixes = 0;
  let suggestions = 0;

  for (const layer of status.layers) {
    if (layer.exists) {
      lines.push(`  ${pc.green("✓")} ${layer.name.padEnd(12)} ${pc.green(layer.summary)}`);
      healthy++;
    } else {
      const isRequired = ["identity", "rules"].includes(layer.name.toLowerCase());
      if (isRequired) {
        lines.push(`  ${pc.red("✗")} ${layer.name.padEnd(12)} ${pc.red("missing")}`);
        lines.push(`    ${pc.dim("→ Fix: aman-agent init")}`);
        fixes++;
      } else {
        lines.push(`  ${pc.yellow("⚠")} ${layer.name.padEnd(12)} ${pc.yellow("empty")}`);
        const cmd = layer.name.toLowerCase() === "workflows" ? "/workflows add <name>"
          : layer.name.toLowerCase() === "tools" ? "/tools add <name> <type> <desc>"
          : layer.name.toLowerCase() === "skills" ? "/skills install <name>"
          : "";
        if (cmd) lines.push(`    ${pc.dim(`→ Add with ${cmd}`)}`);
        suggestions++;
      }
    }
  }

  lines.push("");
  lines.push(`  ${status.mcpConnected ? pc.green("✓") : pc.red("✗")} ${"MCP".padEnd(12)} ${status.mcpConnected ? pc.green(`${status.mcpToolCount} tools`) : pc.red("not connected")}`);
  if (!status.mcpConnected) {
    lines.push(`    ${pc.dim("→ Fix: ensure npx is available and network is connected")}`);
    fixes++;
  } else {
    healthy++;
  }

  lines.push(`  ${status.amemConnected ? pc.green("✓") : pc.red("✗")} ${"Memory".padEnd(12)} ${status.amemConnected ? pc.green("connected") : pc.red("not connected")}`);
  if (!status.amemConnected) {
    lines.push(`    ${pc.dim("→ Fix: restart aman-agent (memory initializes automatically)")}`);
    fixes++;
  } else {
    healthy++;
  }

  const total = healthy + fixes + suggestions;
  lines.push("");
  lines.push(`  Overall: ${healthy}/${total} healthy.${fixes > 0 ? ` ${fixes} fix${fixes > 1 ? "es" : ""} needed.` : ""}${suggestions > 0 ? ` ${suggestions} suggestion${suggestions > 1 ? "s" : ""}.` : ""}`);

  return { handled: true, output: lines.join("\n") };
}

function handleHelp(): CommandResult {
  return {
    handled: true,
    output: [
      pc.bold("Commands:"),
      `  ${pc.cyan("/help")}         Show this help`,
      `  ${pc.cyan("/identity")}     View identity [update <section>]`,
      `  ${pc.cyan("/rules")}        View rules [add|remove|toggle ...]`,
      `  ${pc.cyan("/workflows")}    View workflows [add|remove ...]`,
      `  ${pc.cyan("/akit")}         Manage tools [add|remove <tool>]`,
      `  ${pc.cyan("/skills")}       View skills [install|uninstall|crystallize|list --auto]`,
      `  ${pc.cyan("/eval")}         View evaluation [milestone ...]`,
      `  ${pc.cyan("/memory")}       View recent memories [search|fts|since|stats|export|clear|timeline]`,
      `  ${pc.cyan("/reminder")}     Manage reminders [set|check|done]`,
      `  ${pc.cyan("/status")}       Ecosystem dashboard`,
      `  ${pc.cyan("/doctor")}       Health check all layers`,
      `  ${pc.cyan("/decisions")}    View decision log [<project>]`,
      `  ${pc.cyan("/export")}       Export conversation to markdown`,
      `  ${pc.cyan("/debug")}        Show debug log`,
      `  ${pc.cyan("/save")}         Save conversation to memory`,
      `  ${pc.cyan("/model")}        Show current LLM model`,
      `  ${pc.cyan("/plan")}         Manage multi-step plans`,
      `  ${pc.cyan("/profile me")}   View your profile`,
      `  ${pc.cyan("/profile edit")} Edit your profile`,
      `  ${pc.cyan("/profile")}      List agent profiles`,
      `  ${pc.cyan("/showcase")}     Browse & switch companion templates`,
      `  ${pc.cyan("/delegate")}     Delegate tasks to sub-agents`,
      `  ${pc.cyan("/team")}         Manage agent teams`,
      `  ${pc.cyan("/observe")}      Session observation dashboard [pause|resume]`,
      `  ${pc.cyan("/postmortem")}   Generate post-mortem [last|list|--since 7d]`,
      `  ${pc.cyan("/update")}       Check for updates`,
      `  ${pc.cyan("/reset")}       Full reset [all|memory|config|identity|rules]`,
      `  ${pc.cyan("/clear")}        Clear conversation history`,
      `  ${pc.cyan("/quit")}         Exit`,
    ].join("\n"),
  };
}

function handleSave(): CommandResult {
  return { handled: true, saveConversation: true };
}

function handleReset(action: string | undefined): CommandResult {
  const dirs = {
    config: path.join(os.homedir(), ".aman-agent"),
    memory: path.join(os.homedir(), ".amem"),
    identity: path.join(os.homedir(), ".acore"),
    rules: path.join(os.homedir(), ".arules"),
  };

  if (action === "help" || !action) {
    return {
      handled: true,
      output: [
        pc.bold("Reset options:"),
        `  ${pc.cyan("/reset all")}        Full reset — config, memory, identity, rules`,
        `  ${pc.cyan("/reset memory")}     Clear all memories only`,
        `  ${pc.cyan("/reset config")}     Reset LLM config only`,
        `  ${pc.cyan("/reset identity")}   Reset persona/identity only`,
        `  ${pc.cyan("/reset rules")}      Reset guardrails only`,
        "",
        pc.dim("Directories:"),
        ...Object.entries(dirs).map(([k, v]) => `  ${k}: ${pc.dim(v)}`),
      ].join("\n"),
    };
  }

  const targets: Array<keyof typeof dirs> =
    action === "all" ? ["config", "memory", "identity", "rules"] : [action as keyof typeof dirs];

  if (!targets.every((t) => t in dirs)) {
    return { handled: true, output: pc.red(`Unknown target: ${action}. Use /reset help`) };
  }

  const removed: string[] = [];
  for (const target of targets) {
    const dir = dirs[target];
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(target);
    }
  }

  // Write .reconfig marker so next run forces interactive LLM prompt
  if (targets.includes("config")) {
    const configDir = dirs.config;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, ".reconfig"), "", "utf-8");
  }

  if (removed.length === 0) {
    return { handled: true, output: pc.dim("Nothing to reset — directories don't exist.") };
  }

  return {
    handled: true,
    quit: true,
    output: [
      pc.green(`Reset complete: ${removed.join(", ")}`),
      "Restart aman-agent to begin fresh.",
    ].join("\n"),
  };
}

function handleUpdate(): CommandResult {
  try {
    const current = execFileSync("npm", ["view", "@aman_asmuei/aman-agent", "version"], { encoding: "utf-8" }).trim();
    const local = typeof __VERSION__ !== "undefined" ? __VERSION__ : "unknown";
    if (current === local) {
      return { handled: true, output: `${pc.green("Up to date")} — v${local}` };
    }
    // Detect vendored install (node lives inside ~/.aman-agent/node/)
    const isVendored = process.execPath.includes(path.join(".aman-agent", "node"));
    const updateCmd = isVendored
      ? "aman-agent update"
      : "npm install -g @aman_asmuei/aman-agent@latest";

    return {
      handled: true,
      output: [
        `${pc.yellow("Update available:")} v${local} → v${current}`,
        "",
        `Run this in your terminal:`,
        `  ${pc.bold(updateCmd)}`,
      ].join("\n"),
    };
  } catch {
    return {
      handled: true,
      output: [
        `To update, run in your terminal:`,
        `  ${pc.bold("npm install -g @aman_asmuei/aman-agent@latest")}`,
      ].join("\n"),
    };
  }
}

async function handleDecisionsCommand(
  action: string | undefined,
  _args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  try {
    const result = await memoryRecall("decision", { type: "decision", limit: 20 });
    if (result.total === 0) {
      return { handled: true, output: pc.dim("No decisions recorded yet.") };
    }
    return { handled: true, output: pc.bold("Decision Log:\n") + result.text };
  } catch (err) {
    return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
  }
}

function handleExportCommand(): CommandResult {
  return { handled: true, exportConversation: true };
}

function handleDebugCommand(): CommandResult {
  const logPath = path.join(os.homedir(), ".aman-agent", "debug.log");
  if (!fs.existsSync(logPath)) {
    return { handled: true, output: pc.dim("No debug log found.") };
  }
  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.trim().split("\n");
  const last20 = lines.slice(-20).join("\n");
  return { handled: true, output: pc.bold("Debug Log (last 20 entries):\n") + pc.dim(last20) };
}

// --- Main Router ---

// --- Teams ---

async function handleTeamCommand(action: string | undefined, args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!action || action === "list") {
    const teams = listTeams();
    if (teams.length === 0) {
      return {
        handled: true,
        output: pc.dim("No teams yet. Create one:") +
          "\n  /team create <name>     Create from built-in template" +
          "\n  /team create            Show available templates",
      };
    }
    const lines = teams.map((t) => {
      const members = t.members.map((m) => m.profile).join(", ");
      return `  ${pc.bold(t.name)} (${t.workflow}) — ${members}`;
    });
    return { handled: true, output: "Teams:\n" + lines.join("\n") };
  }

  switch (action) {
    case "create": {
      const name = args[0];
      if (!name) {
        const lines = BUILT_IN_TEAMS.map((t) => {
          const members = t.members.map((m) => m.profile).join(" → ");
          return `  ${pc.bold(t.name)} (${t.workflow}) — ${members}\n    ${pc.dim(t.goal)}`;
        });
        return {
          handled: true,
          output: "Built-in teams:\n" + lines.join("\n\n") +
            "\n\nUsage:\n  /team create content-team     Install built-in" +
            "\n  /team create <name> <mode> <profile1:role>,<profile2:role>  Custom",
        };
      }

      // Check if it's a built-in template
      const builtIn = BUILT_IN_TEAMS.find((t) => t.name === name);
      if (builtIn) {
        createTeam(builtIn);
        return { handled: true, output: pc.green(`Team installed: ${builtIn.name}`) + "\n\n" + formatTeam(builtIn) };
      }

      // Custom team: /team create <name> <mode> <profile:role>,<profile:role>
      const mode = args[1] as Team["workflow"];
      const membersStr = args[2];
      if (!mode || !membersStr) {
        return { handled: true, output: pc.yellow("Usage: /team create <name> <pipeline|parallel|coordinator> <profile1:role>,<profile2:role>") };
      }
      if (!["pipeline", "parallel", "coordinator"].includes(mode)) {
        return { handled: true, output: pc.yellow("Mode must be: pipeline, parallel, or coordinator") };
      }

      const members = membersStr.split(",").map((m) => {
        const [profile, ...roleParts] = m.trim().split(":");
        return { profile: profile.trim(), role: roleParts.join(":").trim() || profile.trim() };
      });

      const team: Team = {
        name,
        goal: `Team: ${name}`,
        coordinator: "default",
        members,
        workflow: mode,
      };
      createTeam(team);
      return { handled: true, output: pc.green(`Team created!`) + "\n\n" + formatTeam(team) };
    }

    case "run": {
      const teamName = args[0];
      const task = args.slice(1).join(" ");
      if (!teamName || !task) {
        return { handled: true, output: pc.yellow("Usage: /team run <team-name> <task description>") };
      }

      const team = loadTeam(teamName);
      if (!team) return { handled: true, output: pc.red(`Team not found: ${teamName}`) };

      if (!ctx.llmClient || !ctx.mcpManager) {
        return { handled: true, output: pc.red("Team execution requires LLM client and MCP.") };
      }

      const result = await runTeam(team, task, ctx.llmClient, ctx.mcpManager, ctx.tools);
      return { handled: true, output: formatTeamResult(result) };
    }

    case "show": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /team show <name>") };
      const team = loadTeam(name);
      if (!team) return { handled: true, output: pc.red(`Team not found: ${name}`) };
      return { handled: true, output: formatTeam(team) };
    }

    case "delete": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /team delete <name>") };
      if (!deleteTeam(name)) return { handled: true, output: pc.red(`Team not found: ${name}`) };
      return { handled: true, output: pc.dim(`Team deleted: ${name}`) };
    }

    case "help":
      return { handled: true, output: `Team commands:
  /team                          List all teams
  /team create                   Show built-in templates
  /team create <name>            Install built-in team
  /team create <n> <mode> <m>    Custom team (mode: pipeline|parallel|coordinator)
  /team run <name> <task>        Run a task with a team
  /team show <name>              Show team details
  /team delete <name>            Delete a team

Modes:
  pipeline     Sequential: agent1 → agent2 → agent3
  parallel     All agents work concurrently, coordinator merges
  coordinator  Coordinator LLM decides how to split the task

Examples:
  /team create content-team
  /team run content-team Write a blog post about AI companions
  /team create review-squad pipeline coder:implement,researcher:review
  /team run review-squad Build a rate limiter in TypeScript` };

    default:
      return { handled: true, output: pc.yellow(`Unknown team action: ${action}. Try /team help`) };
  }
}

// --- Delegation ---

async function handleDelegateCommand(action: string | undefined, args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!action) {
    return { handled: true, output: `Delegate commands:
  /delegate <profile> <task>        Delegate a task to a local profile
  /delegate @<name> <task>          Delegate to another running aman-agent (A2A)
  /delegate pipeline <p1> <p2> ...  Run a sequential pipeline
  /delegate help                    Show help

Examples:
  /delegate writer Write a blog post about AI companions
  /delegate coder Review this code for security issues
  /delegate @reviewer Review PR #42 for security issues
  /delegate pipeline writer,researcher Write and fact-check an article about quantum computing` };
  }

  if (action === "help") {
    return { handled: true, output: `Delegate a task to a sub-agent with a specific profile.

The sub-agent runs with its own identity, rules, and skills but shares
your memory and tools. Results come back to you.

Usage:
  /delegate <profile> <task>             Local sub-agent with named profile
  /delegate @<name> <task>               Remote aman-agent (A2A via MCP)
  /delegate pipeline <profile1>,<profile2> <task>

Use /agents list to see which remote agents are running.

The pipeline mode passes each agent's output to the next:
  writer drafts → researcher reviews → writer polishes` };
  }

  if (!ctx.llmClient || !ctx.mcpManager) {
    return { handled: true, output: pc.red("Delegation requires LLM client and MCP. Not available.") };
  }

  if (action === "pipeline") {
    // /delegate pipeline writer,researcher,writer Write an article about AI
    const profileList = args[0];
    const task = args.slice(1).join(" ");
    if (!profileList || !task) {
      return { handled: true, output: pc.yellow("Usage: /delegate pipeline <profile1>,<profile2> <task>") };
    }

    const profiles = profileList.split(",").map((p) => p.trim());
    const steps = profiles.map((profile, i) => {
      if (i === 0) {
        return { profile, taskTemplate: task };
      }
      return { profile, taskTemplate: `Review and improve the following:\n\n{{input}}` };
    });

    process.stdout.write(pc.dim(`\n  Pipeline: ${profiles.join(" → ")}\n`));

    const results = await delegatePipeline(steps, task, ctx.llmClient, ctx.mcpManager, { tools: ctx.tools });

    const output: string[] = [];
    for (const r of results) {
      if (r.success) {
        output.push(`\n${pc.bold(`[${r.profile}]`)} ${pc.green("✓")} (${r.turns} tool turns)`);
        output.push(r.response.slice(0, 2000));
        if (r.toolsUsed.length > 0) output.push(pc.dim(`  Tools: ${r.toolsUsed.join(", ")}`));
      } else {
        output.push(`\n${pc.bold(`[${r.profile}]`)} ${pc.red("✗")} ${r.error}`);
      }
    }

    return { handled: true, output: output.join("\n") };
  }

  // /delegate <profile> <task>
  const profile = action;
  const task = args.join(" ");
  if (!task) {
    return { handled: true, output: pc.yellow(`Usage: /delegate ${profile} <task description>`) };
  }

  process.stdout.write(pc.dim(`\n  [delegating to ${profile}...]\n\n`));

  const result = await delegateTask(task, profile, ctx.llmClient, ctx.mcpManager, { tools: ctx.tools });

  if (!result.success) {
    return { handled: true, output: pc.red(`Delegation failed: ${result.error}`) };
  }

  const meta: string[] = [];
  if (result.toolsUsed.length > 0) meta.push(`Tools: ${result.toolsUsed.join(", ")}`);
  if (result.turns > 0) meta.push(`${result.turns} tool turns`);

  return {
    handled: true,
    output: `\n${pc.bold(`[${profile}]`)} ${pc.green("✓")}${meta.length > 0 ? " " + pc.dim(`(${meta.join(", ")})`) : ""}\n\n${result.response}`,
  };
}

// --- Agents (A2A discovery + health) ---

async function handleAgentsCommand(
  action: string | undefined,
  args: string[],
): Promise<CommandResult> {
  const sub = action ?? "list";

  if (sub === "list") {
    const all = await listAgents();
    if (all.length === 0) {
      return { handled: true, output: "No agents running." };
    }
    const rows = all.map((a) => {
      const uptime = Math.round((Date.now() - a.started_at) / 1000);
      return `  @${a.name.padEnd(12)} ${a.profile.padEnd(12)} pid=${String(a.pid).padEnd(6)} port=${a.port}  up ${uptime}s`;
    });
    return { handled: true, output: ["Running agents:", ...rows].join("\n") };
  }

  if (sub === "info") {
    const name = args[0];
    if (!name) {
      return { handled: true, output: pc.yellow("Usage: /agents info <name>") };
    }
    const entry = await findAgent(name);
    if (!entry) {
      return { handled: true, output: `No such agent: ${name}` };
    }
    const url = new URL(`http://127.0.0.1:${entry.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${entry.token}` } },
    });
    const client = new Client({ name: "aman-agent-cli", version: "0.1.0" });
    try {
      await client.connect(transport);
      const res = await client.callTool({ name: "agent.info", arguments: {} });
      const text = Array.isArray(res.content)
        ? (res.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
        : "";
      return { handled: true, output: `@${entry.name}:\n${text}` };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Error calling @${name}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    } finally {
      try {
        await client.close();
      } catch {
        /* best effort */
      }
    }
  }

  if (sub === "ping") {
    const name = args[0];
    if (!name) {
      return { handled: true, output: pc.yellow("Usage: /agents ping <name>") };
    }
    const entry = await findAgent(name);
    if (!entry) {
      return { handled: true, output: `No such agent: ${name}` };
    }
    const t0 = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${entry.port}/health`, {
        headers: { Authorization: `Bearer ${entry.token}` },
      });
      if (!res.ok) {
        return { handled: true, output: `@${name}: HTTP ${res.status}` };
      }
      return { handled: true, output: `@${name}: ok (${Date.now() - t0}ms)` };
    } catch (err) {
      return {
        handled: true,
        output: `@${name}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    handled: true,
    output: pc.yellow("Usage: /agents [list|info <name>|ping <name>]"),
  };
}

// --- Profile management ---

function handleProfileCommand(action: string | undefined, args: string[]): CommandResult {
  const profilesDir = path.join(os.homedir(), ".acore", "profiles");

  // User identity commands (separate from AI agent profiles)
  if (action === "me") {
    const user = loadUserIdentity();
    if (!user) {
      return { handled: true, output: pc.dim("No user profile yet. Run /profile edit to set one up.") };
    }
    const lines = [
      `  ${pc.bold("Name:")}       ${user.name}`,
      `  ${pc.bold("Role:")}       ${user.roleLabel}`,
      `  ${pc.bold("Expertise:")}  ${user.expertiseLabel}`,
      `  ${pc.bold("Style:")}      ${user.styleLabel}`,
    ];
    if (user.workingOn) lines.push(`  ${pc.bold("Working on:")} ${user.workingOn}`);
    if (user.notes) lines.push(`  ${pc.bold("Notes:")}      ${user.notes}`);
    lines.push(`  ${pc.dim(`Updated: ${user.updatedAt}`)}`);
    return { handled: true, output: `Your profile:\n${lines.join("\n")}\n\n${pc.dim("Edit with: /profile edit")}` };
  }

  if (action === "edit") {
    const current = loadUserIdentity();
    if (!current) {
      // No profile yet — run full onboarding
      runOnboarding().then(() => {}).catch(() => {});
      return { handled: true, output: "" }; // onboarding handles its own output
    }
    // Edit existing profile
    editProfile(current).then(() => {}).catch(() => {});
    return { handled: true, output: "" }; // editProfile handles its own output
  }

  if (action === "setup") {
    // Force re-run full onboarding
    runOnboarding().then(() => {}).catch(() => {});
    return { handled: true, output: "" };
  }

  if (!action || action === "list") {
    const profiles = listProfiles();
    const user = loadUserIdentity();
    const userLine = user
      ? `${pc.bold("You:")} ${user.name} (${user.roleLabel}, ${user.expertiseLabel})\n\n`
      : `${pc.dim("No user profile. Set up with: /profile edit")}\n\n`;

    if (profiles.length === 0) {
      return { handled: true, output: userLine + pc.dim("No agent profiles yet. Create one with: /profile create <name>") };
    }
    const lines = profiles.map((p) =>
      `  ${pc.bold(p.name)} — ${p.aiName} (${pc.dim(p.personality)})`
    );
    return { handled: true, output: userLine + "Agent profiles:\n" + lines.join("\n") + "\n\n" + pc.dim("Switch with: aman-agent --profile <name>") };
  }

  switch (action) {
    case "create": {
      const name = args[0];
      if (!name) {
        // Show available templates
        const lines = BUILT_IN_PROFILES.map((t) =>
          `  ${pc.bold(t.name)} — ${t.label}: ${pc.dim(t.description)}`
        );
        return {
          handled: true,
          output: "Built-in profiles:\n" + lines.join("\n") +
            "\n\nUsage:\n  /profile create coder     Install built-in template" +
            "\n  /profile create <custom>  Create blank profile",
        };
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const profileDir = path.join(profilesDir, slug);

      if (fs.existsSync(profileDir)) {
        return { handled: true, output: pc.yellow(`Profile already exists: ${slug}`) };
      }

      // Check if it's a built-in template
      const builtIn = BUILT_IN_PROFILES.find((t) => t.name === slug);
      if (builtIn) {
        const err = installProfileTemplate(slug);
        if (err) return { handled: true, output: pc.red(err) };
        return {
          handled: true,
          output: pc.green(`Profile installed: ${builtIn.label}`) +
            `\n  AI name: ${builtIn.core.match(/^# (.+)/m)?.[1] || slug}` +
            `\n  ${pc.dim(builtIn.description)}` +
            `\n\n  Use: aman-agent --profile ${slug}`,
        };
      }

      // Custom profile — create from default
      fs.mkdirSync(profileDir, { recursive: true });
      const globalCore = path.join(os.homedir(), ".acore", "core.md");
      if (fs.existsSync(globalCore)) {
        let content = fs.readFileSync(globalCore, "utf-8");
        const aiName = name.charAt(0).toUpperCase() + name.slice(1);
        content = content.replace(/^# .+$/m, `# ${aiName}`);
        fs.writeFileSync(path.join(profileDir, "core.md"), content, "utf-8");
      } else {
        const aiName = name.charAt(0).toUpperCase() + name.slice(1);
        fs.writeFileSync(path.join(profileDir, "core.md"), `# ${aiName}\n\n## Identity\n- Role: ${aiName} is your AI companion\n- Personality: helpful, adaptive\n- Communication: clear and concise\n- Values: honesty, simplicity\n- Boundaries: won't pretend to be human\n`, "utf-8");
      }

      return {
        handled: true,
        output: pc.green(`Profile created: ${slug}`) +
          `\n  Edit: ${path.join(profileDir, "core.md")}` +
          `\n  Use: aman-agent --profile ${slug}` +
          `\n\n  ${pc.dim("Add rules.md or skills.md for profile-specific overrides.")}`,
      };
    }

    case "show": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /profile show <name>") };
      const profileDir = path.join(profilesDir, name);
      if (!fs.existsSync(profileDir)) return { handled: true, output: pc.red(`Profile not found: ${name}`) };

      const files = fs.readdirSync(profileDir).filter((f) => f.endsWith(".md"));
      const lines = files.map((f) => `  ${f}`);
      return { handled: true, output: `Profile: ${pc.bold(name)}\nFiles:\n${lines.join("\n")}` };
    }

    case "delete": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /profile delete <name>") };
      const profileDir = path.join(profilesDir, name);
      if (!fs.existsSync(profileDir)) return { handled: true, output: pc.red(`Profile not found: ${name}`) };

      fs.rmSync(profileDir, { recursive: true });
      return { handled: true, output: pc.dim(`Profile deleted: ${name}`) };
    }

    case "help":
      return { handled: true, output: `Profile commands:

  ${pc.bold("Your profile:")}
  /profile me           View your profile
  /profile edit         Edit your profile
  /profile setup        Re-run full profile setup

  ${pc.bold("Agent profiles:")}
  /profile              List all profiles
  /profile create <n>   Create new agent profile
  /profile show <n>     Show agent profile files
  /profile delete <n>   Delete an agent profile

  ${pc.bold("Use agent profiles:")}
  aman-agent --profile <name>
  AMAN_PROFILE=<name> aman-agent` };

    default:
      return { handled: true, output: pc.yellow(`Unknown profile action: ${action}. Try /profile help`) };
  }
}

// --- Plan management ---

function handlePlanCommand(action: string | undefined, args: string[], ctx?: CommandContext): CommandResult {
  if (!action) {
    // /plan — show active plan
    const active = getActivePlan();
    if (!active) {
      return { handled: true, output: pc.dim("No active plan. Create one with: /plan create <name> | <goal> | <step1>, <step2>, ...") };
    }
    return { handled: true, output: formatPlan(active) };
  }

  switch (action) {
    case "create": {
      // /plan create <name> | <goal> | <step1>, <step2>, ...
      const fullArgs = args.join(" ");
      const parts = fullArgs.split("|").map((p) => p.trim());
      if (parts.length < 3) {
        return { handled: true, output: pc.yellow("Usage: /plan create <name> | <goal> | <step1>, <step2>, ...") };
      }
      const name = parts[0];
      const goal = parts[1];
      const steps = parts[2].split(",").map((s) => s.trim()).filter(Boolean);
      if (steps.length === 0) {
        return { handled: true, output: pc.yellow("Need at least one step. Separate steps with commas.") };
      }
      const plan = createPlan(name, goal, steps);
      return { handled: true, output: pc.green(`Plan created!\n\n`) + formatPlan(plan) };
    }

    case "done": {
      // /plan done [step number]
      const active = getActivePlan();
      if (!active) return { handled: true, output: pc.yellow("No active plan.") };

      const recordPlanMilestone = (stepIndex: number) => {
        if (ctx?.observationSession) {
          const step = active.steps[stepIndex];
          recordEvent(ctx.observationSession, {
            type: "milestone",
            summary: `Plan step done: ${step.text}`,
            data: { plan: active.name, stepIndex, stepText: step.text },
          });
        }
      };

      if (args.length > 0) {
        const stepNum = parseInt(args[0], 10);
        if (isNaN(stepNum) || stepNum < 1 || stepNum > active.steps.length) {
          return { handled: true, output: pc.yellow(`Invalid step number. Range: 1-${active.steps.length}`) };
        }
        markStepDone(active, stepNum - 1);
        recordPlanMilestone(stepNum - 1);
        return { handled: true, output: pc.green(`Step ${stepNum} done!`) + "\n\n" + formatPlan(active) };
      }

      // No step specified — mark next incomplete step
      const next = active.steps.findIndex((s) => !s.done);
      if (next < 0) return { handled: true, output: pc.green("All steps already complete!") };
      markStepDone(active, next);
      recordPlanMilestone(next);
      return { handled: true, output: pc.green(`Step ${next + 1} done!`) + "\n\n" + formatPlan(active) };
    }

    case "undo": {
      // /plan undo <step number>
      const active = getActivePlan();
      if (!active) return { handled: true, output: pc.yellow("No active plan.") };
      const stepNum = parseInt(args[0], 10);
      if (isNaN(stepNum) || stepNum < 1 || stepNum > active.steps.length) {
        return { handled: true, output: pc.yellow(`Invalid step number. Range: 1-${active.steps.length}`) };
      }
      markStepUndone(active, stepNum - 1);
      return { handled: true, output: pc.dim(`Step ${stepNum} unmarked.`) + "\n\n" + formatPlan(active) };
    }

    case "list": {
      // /plan list — show all plans
      const plans = listPlans();
      if (plans.length === 0) return { handled: true, output: pc.dim("No plans yet.") };
      const lines = plans.map((p) => {
        const done = p.steps.filter((s) => s.done).length;
        const total = p.steps.length;
        const status = p.active ? pc.green("active") : pc.dim("inactive");
        return `  ${p.name} — ${done}/${total} steps (${status})`;
      });
      return { handled: true, output: "Plans:\n" + lines.join("\n") };
    }

    case "switch": {
      // /plan switch <name>
      const name = args.join(" ");
      if (!name) return { handled: true, output: pc.yellow("Usage: /plan switch <name>") };
      const plan = setActivePlan(name);
      if (!plan) return { handled: true, output: pc.red(`Plan not found: ${name}`) };
      return { handled: true, output: pc.green(`Switched to: ${plan.name}`) + "\n\n" + formatPlan(plan) };
    }

    case "show": {
      // /plan show <name>
      const name = args.join(" ");
      if (!name) return { handled: true, output: pc.yellow("Usage: /plan show <name>") };
      const plan = loadPlan(name);
      if (!plan) return { handled: true, output: pc.red(`Plan not found: ${name}`) };
      return { handled: true, output: formatPlan(plan) };
    }

    case "help":
      return { handled: true, output: `Plan commands:
  /plan               Show active plan
  /plan create <name> | <goal> | <step1>, <step2>, ...
  /plan done [step#]  Mark step complete (next if no number)
  /plan undo <step#>  Unmark a step
  /plan list          List all plans
  /plan switch <name> Switch active plan
  /plan show <name>   Show a specific plan` };

    default:
      return { handled: true, output: pc.yellow(`Unknown plan action: ${action}. Try /plan help`) };
  }
}

async function handleReminderCommand(
  action: string | undefined,
  args: string[],
): Promise<CommandResult> {
  if (!action || action === "list") {
    try {
      const reminders = reminderList();
      if (reminders.length === 0) return { handled: true, output: pc.dim("No reminders.") };
      const lines: string[] = [pc.bold(`Reminders (${reminders.length}):`), ""];
      for (const r of reminders) {
        const status = r.completed ? pc.green("[done]") : pc.yellow("[todo]");
        const due = r.dueAt ? ` ${pc.dim(`due: ${new Date(r.dueAt).toLocaleString()}`)}` : "";
        lines.push(`  ${status} ${r.content}${due} ${pc.dim(`(${r.id.slice(0, 8)})`)}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "set" || action === "add") {
    if (args.length === 0) return { handled: true, output: pc.yellow("Usage: /reminder set <text> [--due <time>]\n  Time formats: 1h, 2d, 1w, or ISO date (2026-04-10)") };
    // Parse --due flag
    let dueAt: number | undefined;
    const dueIdx = args.indexOf("--due");
    let contentArgs = args;
    if (dueIdx >= 0 && args[dueIdx + 1]) {
      const dueStr = args[dueIdx + 1];
      contentArgs = [...args.slice(0, dueIdx), ...args.slice(dueIdx + 2)];
      // Parse relative time: 1h, 2d, 1w
      const relMatch = dueStr.match(/^(\d+)(h|d|w)$/);
      if (relMatch) {
        const num = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const ms = unit === "h" ? num * 3600000 : unit === "d" ? num * 86400000 : num * 604800000;
        dueAt = Date.now() + ms;
      } else {
        // Try ISO date
        const parsed = Date.parse(dueStr);
        if (!isNaN(parsed)) dueAt = parsed;
      }
    }
    const content = contentArgs.join(" ");
    if (!content) return { handled: true, output: pc.yellow("Usage: /reminder set <text> [--due <time>]") };
    try {
      const id = reminderSet(content, dueAt);
      const dueInfo = dueAt ? ` (due: ${new Date(dueAt).toLocaleDateString()})` : "";
      return { handled: true, output: pc.green(`Reminder set: "${content}"${dueInfo} (ID: ${id.slice(0, 8)})`) };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "done" || action === "complete") {
    if (!args[0]) return { handled: true, output: pc.yellow("Usage: /reminder done <id>") };
    try {
      const result = reminderComplete(args[0]);
      return { handled: true, output: result ? pc.green("Reminder completed.") : pc.yellow("Reminder not found.") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "check") {
    try {
      const reminders = reminderCheck();
      if (reminders.length === 0) return { handled: true, output: pc.dim("No pending reminders.") };
      const lines: string[] = [pc.bold("Pending Reminders:"), ""];
      for (const r of reminders) {
        const icon = r.status === "overdue" ? pc.red("!!!") : r.status === "today" ? pc.yellow("(!)") : pc.dim("( )");
        const due = r.dueAt ? ` ${pc.dim(`due: ${new Date(r.dueAt).toLocaleString()}`)}` : "";
        lines.push(`  ${icon} ${r.content}${due} ${pc.dim(`[${r.status}]`)}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Reminder commands:"),
      `  ${pc.cyan("/reminder")}                List all reminders`,
      `  ${pc.cyan("/reminder set")} <text>      Create a reminder [--due 1h|2d|1w|date]`,
      `  ${pc.cyan("/reminder check")}           Show overdue/upcoming`,
      `  ${pc.cyan("/reminder done")} <id>       Mark as completed`,
    ].join("\n") };
  }

  return { handled: true, output: pc.yellow(`Unknown action: /reminder ${action}. Try /reminder --help`) };
}

// --- Showcase templates ---

function handleShowcaseCommand(action: string | undefined, args: string[]): CommandResult {
  const showcases = loadShowcaseManifest();

  if (showcases.length === 0) {
    return {
      handled: true,
      output: pc.dim("No showcase templates found.") +
        "\n\n  Install aman-showcase to get 13 pre-built companion personalities:" +
        `\n  ${pc.bold("npm install -g @aman_asmuei/aman-showcase")}` +
        "\n  Or place it as a sibling directory to aman-agent.",
    };
  }

  // Detect current showcase from core.md
  const corePath = path.join(os.homedir(), ".acore", "core.md");
  let currentShowcase: string | null = null;
  if (fs.existsSync(corePath)) {
    const content = fs.readFileSync(corePath, "utf-8");
    const nameMatch = content.match(/^# (.+)/m);
    if (nameMatch) {
      const coreName = nameMatch[1].trim().toLowerCase();
      const match = showcases.find((s) => coreName.includes(s.name) || coreName.includes(s.title.split("—")[0].trim().toLowerCase()));
      if (match) currentShowcase = match.name;
    }
  }

  if (!action || action === "list") {
    const lines = showcases.map((s) => {
      const active = s.name === currentShowcase ? pc.green(" ← active") : "";
      const langBadge = s.language === "ms" ? " [BM]" : s.language === "en+ms" ? " [EN/BM]" : "";
      return `  ${pc.bold(s.name.padEnd(12))} ${s.title}${langBadge}${active}`;
    });
    const currentLine = currentShowcase
      ? `\nCurrent: ${pc.bold(currentShowcase)}\n`
      : `\nNo showcase active (using default personality)\n`;
    return {
      handled: true,
      output: `Showcase templates (${showcases.length}):\n\n${lines.join("\n")}\n${currentLine}\n${pc.dim("Switch with: /showcase install <name>")}`,
    };
  }

  if (action === "install" || action === "switch" || action === "use") {
    const name = args[0];
    if (!name) {
      return { handled: true, output: pc.yellow("Usage: /showcase install <name>\n\nRun /showcase list to see available templates.") };
    }

    const entry = showcases.find((s) => s.name === name);
    if (!entry) {
      return { handled: true, output: pc.red(`Showcase not found: ${name}`) + `\n\nAvailable: ${showcases.map((s) => s.name).join(", ")}` };
    }

    if (name === currentShowcase) {
      return { handled: true, output: pc.dim(`${entry.title} is already active.`) };
    }

    try {
      const result = installShowcaseTemplate(name);
      const lines = [pc.green(`Installed ${pc.bold(entry.title)}`)];
      for (const f of result.installed) {
        lines.push(pc.dim(`  ${f}`));
      }
      if (result.backed_up.length > 0) {
        lines.push(pc.dim(`\n  Backed up ${result.backed_up.length} existing file(s) (.bak)`));
      }
      lines.push("");
      lines.push(pc.yellow("Restart aman-agent to use the new personality."));
      lines.push(pc.dim("Your user profile (/profile me) is unchanged — only the AI personality switched."));
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Failed to install: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "current") {
    if (currentShowcase) {
      const entry = showcases.find((s) => s.name === currentShowcase);
      return { handled: true, output: `Active showcase: ${pc.bold(entry?.title || currentShowcase)}\n${pc.dim(entry?.description || "")}` };
    }
    return { handled: true, output: pc.dim("No showcase active — using default personality.") + `\n${pc.dim("Install one with: /showcase install <name>")}` };
  }

  if (action === "help") {
    return { handled: true, output: `Showcase commands:

  /showcase              List all available templates
  /showcase install <n>  Install/switch to a template
  /showcase current      Show active template

${pc.dim("Showcase templates replace your AI's personality, workflows, rules, and skills.")}
${pc.dim("Your user profile (/profile me) stays unchanged — only the AI personality switches.")}
${pc.dim("Existing files are backed up (.bak) before overwriting.")}` };
  }

  return { handled: true, output: pc.yellow(`Unknown action: /showcase ${action}. Try /showcase help`) };
}

async function handleFileCommand(
  action: string | undefined,
  args: string[],
): Promise<CommandResult> {
  if (!action) {
    return {
      handled: true,
      output: [
        pc.bold("File commands:"),
        `  ${pc.cyan("/file read")} <path>               Read a text file (max 50 KB)`,
        `  ${pc.cyan("/file convert")} <path>            Attempt to read binary file as text`,
        `  ${pc.cyan("/file list")} <path> [--recursive]  List directory contents`,
      ].join("\n"),
    };
  }

  if (action === "read" || action === "convert") {
    const filePath = args[0];
    if (!filePath) {
      return { handled: true, output: pc.yellow(`Usage: /file ${action} <path>`) };
    }
    try {
      const result = await readFile(filePath);
      const lines: string[] = [
        pc.bold(`📄 ${result.path}`) + pc.dim(` (${(result.size / 1024).toFixed(1)} KB)`),
        "",
        result.content,
      ];
      if (result.truncated) {
        lines.push("", pc.yellow(`⚠ File truncated at 50 KB. Use a text editor for the full file.`));
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`File error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "list") {
    const dirPath = args.find((a) => !a.startsWith("-"));
    if (!dirPath) {
      return { handled: true, output: pc.yellow(`Usage: /file list <path> [--recursive]`) };
    }
    const recursive = args.includes("--recursive") || args.includes("-r");
    try {
      const result = await listFiles(dirPath, { recursive });
      const lines: string[] = [
        pc.bold(`📁 ${result.path}`) + pc.dim(` (${result.total} items)`),
        "",
      ];
      for (const entry of result.entries) {
        if (entry.type === "dir") {
          lines.push(`  ${pc.cyan(entry.name + "/")}`);
        } else {
          const kb = entry.size > 0 ? pc.dim(` ${(entry.size / 1024).toFixed(1)} KB`) : "";
          lines.push(`  ${entry.name}${kb}`);
        }
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`File error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  return { handled: true, output: pc.yellow(`Unknown /file subcommand: ${action}. Try /file for help.`) };
}

async function handleOrchestrateCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    return {
      handled: true,
      output: [
        "Usage: /orchestrate <requirement>",
        "",
        "Decomposes a requirement into a task DAG and executes it with parallel agents.",
        "Auto-detects project type, selects template, runs policy check, and tracks cost.",
        "",
        "Options (pass as first arg):",
        "  --template <name>   Force a template (full-feature, bug-fix, security-audit)",
        "  --no-review         Skip self-review loop",
        "  --no-policy         Skip policy check",
        "",
        "Alias: /orch",
      ].join("\n"),
    };
  }

  if (!ctx.llmClient) {
    return { handled: true, output: pc.red("Orchestration requires an LLM client. Not available.") };
  }

  // Parse flags
  let templateName: string | undefined;
  let enableSelfReview = true;
  let enablePolicyCheck = true;
  const filtered: string[] = [];

  const allArgs = [action, ...args];
  for (let i = 0; i < allArgs.length; i++) {
    if (allArgs[i] === "--template" && allArgs[i + 1]) {
      templateName = allArgs[++i];
    } else if (allArgs[i] === "--no-review") {
      enableSelfReview = false;
    } else if (allArgs[i] === "--no-policy") {
      enablePolicyCheck = false;
    } else {
      filtered.push(allArgs[i]);
    }
  }

  const requirement = filtered.join(" ");
  if (!requirement.trim()) {
    return { handled: true, output: pc.red("Please provide a requirement to orchestrate.") };
  }

  try {
    const router = createModelRouter({ standard: ctx.llmClient });
    const result = await smartOrchestrate({
      requirement,
      client: ctx.llmClient,
      router,
      projectPath: process.cwd(),
      templateName,
      enablePolicyCheck,
      enableSelfReview,
      enableCostTracking: true,
    });

    return { handled: true, output: result.summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { handled: true, output: pc.red(`Orchestration failed: ${msg}`) };
  }
}

async function handleGitHubCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  // No subcommand → show repo info
  if (!action) {
    const available = await ghAvailable();
    if (!available) {
      return { handled: true, output: pc.red("GitHub CLI (gh) is not available or not authenticated. Run: gh auth login") };
    }
    const repo = await ghCurrentRepo();
    if (!repo) {
      return { handled: true, output: pc.yellow("Not inside a GitHub repository.") };
    }
    return { handled: true, output: `GitHub repo: ${pc.bold(`${repo.owner}/${repo.name}`)}` };
  }

  switch (action) {
    case "issues": {
      // Quick issue list via gh CLI
      const { gh: ghExec } = await import("./github/index.js");
      const repoArgs = args.length > 0 ? ["--repo", args[0]] : [];
      const result = await ghExec(["issue", "list", "--limit", "10", ...repoArgs]);
      if (!result.success) {
        return { handled: true, output: pc.red(`Failed to list issues: ${result.stderr}`) };
      }
      return { handled: true, output: result.stdout.trim() || pc.dim("No open issues.") };
    }

    case "prs": {
      const repoArgs: { repo?: string } = args.length > 0 ? { repo: args[0] } : {};
      try {
        const prs = await listPRs({ state: "open", limit: 10, ...repoArgs });
        if (prs.length === 0) {
          return { handled: true, output: pc.dim("No open PRs.") };
        }
        const lines = prs.map(
          (pr) => `#${pr.number} ${pr.title} (${pr.headRefName} → ${pr.baseRefName})${pr.isDraft ? " [draft]" : ""}`,
        );
        return { handled: true, output: lines.join("\n") };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, output: pc.red(`Failed to list PRs: ${msg}`) };
      }
    }

    case "plan": {
      const issueNum = parseInt(args[0], 10);
      if (!issueNum || isNaN(issueNum)) {
        return { handled: true, output: pc.red("Usage: /github plan <issue-number>") };
      }
      if (!ctx.llmClient) {
        return { handled: true, output: pc.red("Planning requires an LLM client. Not available.") };
      }
      try {
        const issue = await fetchIssue(issueNum);
        const requirement = formatIssueAsRequirement(issue);
        const router = createModelRouter({ standard: ctx.llmClient });
        const result = await smartOrchestrate({
          requirement,
          client: ctx.llmClient,
          router,
          projectPath: process.cwd(),
          enablePolicyCheck: true,
          enableSelfReview: false,
          enableCostTracking: true,
        });
        return {
          handled: true,
          output: `${pc.bold(`Plan for #${issue.number}: ${issue.title}`)}\n\n${result.summary}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, output: pc.red(`Failed to plan issue #${issueNum}: ${msg}`) };
      }
    }

    case "ci": {
      const branch = args[0];
      if (!branch) {
        return { handled: true, output: pc.red("Usage: /github ci <branch>") };
      }
      try {
        const passing = await isCIPassing(branch);
        return {
          handled: true,
          output: passing
            ? pc.green(`CI is passing on ${branch}`)
            : pc.yellow(`CI is NOT passing on ${branch}`),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, output: pc.red(`Failed to check CI: ${msg}`) };
      }
    }

    default:
      return {
        handled: true,
        output: [
          `Usage: /github [subcommand]`,
          ``,
          `Subcommands:`,
          `  (none)           Show current repo info`,
          `  issues [repo]    List open issues`,
          `  prs [repo]       List open PRs`,
          `  plan <number>    Plan from a GitHub issue`,
          `  ci <branch>      Check CI status for a branch`,
        ].join("\n"),
      };
  }
}

const KNOWN_COMMANDS = new Set([
  "quit", "exit", "q", "help", "clear", "model", "identity", "rules",
  "workflows", "tools", "akit", "skills", "eval", "memory", "status", "doctor",
  "save", "decisions", "export", "debug", "reset", "reminder",
  "update", "upgrade", "plan", "profile", "delegate", "team", "agents", "showcase", "file",
  "observe", "postmortem", "orchestrate", "orch", "github",
]);

async function handleObserveCommand(
  action: string | undefined,
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!ctx.observationSession) {
    return {
      handled: true,
      output: pc.dim("Observation is disabled. Enable with recordObservations: true in config."),
    };
  }

  switch (action) {
    case "pause":
      pauseObservation(ctx.observationSession);
      return { handled: true, output: pc.dim("Observation paused. Use /observe resume to continue.") };

    case "resume":
      resumeObservation(ctx.observationSession);
      return { handled: true, output: pc.dim("Observation resumed.") };

    default:
      return { handled: true, output: getSessionStats(ctx.observationSession) };
  }
}

async function handlePostmortemCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  switch (action) {
    case "last": {
      const files = await listPostmortems();
      if (files.length === 0) return { handled: true, output: pc.dim("No post-mortems found.") };
      const content = await readPostmortem(files[0]);
      return { handled: true, output: content ?? pc.red("Could not read post-mortem.") };
    }

    case "list": {
      const files = await listPostmortems();
      if (files.length === 0) return { handled: true, output: pc.dim("No post-mortems found.") };
      return { handled: true, output: "Post-mortems:\n" + files.map((f) => `  ${f}`).join("\n") };
    }

    default: {
      // Check for --since flag (in either action or args position)
      const allArgs = action ? [action, ...args] : args;
      const sinceIdx = allArgs.indexOf("--since");
      if (sinceIdx !== -1 && allArgs[sinceIdx + 1]) {
        const daysStr = allArgs[sinceIdx + 1];
        const days = parseInt(daysStr.replace("d", ""), 10) || 7;
        if (!ctx.llmClient) {
          return { handled: true, output: pc.red("LLM client not available for analysis.") };
        }
        const analysis = await analyzePostmortemRange(days, ctx.llmClient);
        return { handled: true, output: analysis ?? pc.red("Could not analyze post-mortems.") };
      }

      // Generate post-mortem for current session
      if (!ctx.observationSession || !ctx.llmClient || !ctx.messages) {
        return {
          handled: true,
          output: pc.dim("Cannot generate post-mortem: missing session context."),
        };
      }
      const report = await generatePostmortemReport(
        ctx.observationSession.sessionId,
        ctx.messages,
        ctx.observationSession,
        ctx.llmClient,
      );
      if (!report) return { handled: true, output: pc.red("Could not generate post-mortem.") };
      const filePath = await savePostmortem(report);
      return {
        handled: true,
        output: formatPostmortemMarkdown(report) + `\n\n${pc.dim(`Saved → ${filePath}`)}`,
      };
    }
  }
}

export async function handleCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  const { base, action, args } = parseCommand(trimmed);

  // Don't treat file paths (e.g., /Users/...) as commands
  if (!KNOWN_COMMANDS.has(base)) return { handled: false };

  switch (base) {
    case "quit":
    case "exit":
    case "q":
      return { handled: true, quit: true };
    case "help":
      return handleHelp();
    case "clear":
      return { handled: true, output: pc.dim("Conversation cleared."), clearHistory: true };
    case "model":
      return { handled: true, output: ctx.model ? `Model: ${pc.bold(ctx.model)}` : "Model: unknown" };
    case "identity":
      return handleIdentityCommand(action, args, ctx);
    case "rules":
      return handleRulesCommand(action, args, ctx);
    case "workflows":
      return handleWorkflowsCommand(action, args, ctx);
    case "tools":
      return handleToolsCommand(action, args, ctx);
    case "akit":
      return handleAkitCommand(action, args);
    case "skills":
      return handleSkillsCommand(action, args, ctx);
    case "eval":
      return handleEvalCommand(action, args, ctx);
    case "memory":
      return handleMemoryCommand(action, args, ctx);
    case "status":
      return handleStatusCommand(ctx);
    case "doctor":
      return handleDoctorCommand(ctx);
    case "save":
      return handleSave();
    case "decisions":
      return handleDecisionsCommand(action, args, ctx);
    case "export":
      return handleExportCommand();
    case "debug":
      return handleDebugCommand();
    case "reset":
      return handleReset(action);
    case "plan":
      return handlePlanCommand(action, args, ctx);
    case "profile":
      return handleProfileCommand(action, args);
    case "delegate":
      return handleDelegateCommand(action, args, ctx);
    case "team":
      return handleTeamCommand(action, args, ctx);
    case "agents":
      return handleAgentsCommand(action, args);
    case "reminder":
      return handleReminderCommand(action, args);
    case "showcase":
      return handleShowcaseCommand(action, args);
    case "file":
      return handleFileCommand(action, args);
    case "update":
    case "upgrade":
      return handleUpdate();
    case "observe":
      return handleObserveCommand(action, ctx);
    case "postmortem":
      return handlePostmortemCommand(action, args, ctx);
    case "orchestrate":
    case "orch":
      return handleOrchestrateCommand(action, args, ctx);
    case "github":
      return handleGitHubCommand(action, args, ctx);
    default:
      return { handled: false }; // Pass to LLM if not matched
  }
}
