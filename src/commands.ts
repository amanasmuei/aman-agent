import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import type { McpManager } from "./mcp/client.js";
import { getEcosystemStatus } from "./layers/parsers.js";
import { listProfiles } from "./prompt.js";
import { BUILT_IN_PROFILES, installProfileTemplate } from "./profile-templates.js";
import { delegateTask, delegatePipeline } from "./delegate.js";
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
  const action = parts.length > 1 ? parts[1].toLowerCase() : undefined;
  const args = parts.slice(2);
  return { base, action, args };
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
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".acore", "core.md"), "identity (acore)");
    return { handled: true, output: content };
  }
  if (action === "update") {
    if (args.length === 0) {
      return {
        handled: true,
        output: pc.yellow("Usage: /identity update <section>\nTip: describe changes in natural language and the AI will update via MCP."),
      };
    }
    const section = args[0];
    const content = args.slice(1).join(" ");
    if (!content) {
      return {
        handled: true,
        output: pc.yellow("Usage: /identity update <section> <new content...>\nExample: /identity update Personality Warm, curious, and direct."),
      };
    }
    const output = await mcpWrite(ctx, "identity", "identity_update_section", { section, content });
    return { handled: true, output };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /identity ${action}. Use /identity or /identity update <section>.`) };
}

async function handleRulesCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".arules", "rules.md"), "guardrails (arules)");
    return { handled: true, output: content };
  }
  if (action === "add") {
    if (args.length < 2) {
      return { handled: true, output: pc.yellow("Usage: /rules add <category> <rule text...>") };
    }
    const category = args[0];
    const rule = args.slice(1).join(" ");
    const output = await mcpWrite(ctx, "rules", "rules_add", { category, rule });
    return { handled: true, output };
  }
  if (action === "remove") {
    if (args.length < 2) {
      return { handled: true, output: pc.yellow("Usage: /rules remove <category> <index>") };
    }
    const output = await mcpWrite(ctx, "rules", "rules_remove", { category: args[0], index: parseInt(args[1], 10) });
    return { handled: true, output };
  }
  if (action === "toggle") {
    if (args.length < 2) {
      return { handled: true, output: pc.yellow("Usage: /rules toggle <category> <index>") };
    }
    const output = await mcpWrite(ctx, "rules", "rules_toggle", { category: args[0], index: parseInt(args[1], 10) });
    return { handled: true, output };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /rules ${action}. Use /rules [add|remove|toggle].`) };
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
  return { handled: true, output: pc.yellow(`Unknown action: /workflows ${action}. Use /workflows [add|remove].`) };
}

// akit registry — keep in sync with @aman_asmuei/akit/src/lib/registry.ts
interface AkitTool {
  name: string;
  description: string;
  category: string;
  mcp: { package: string; command: string; args: string[]; env?: Record<string, string> } | null;
  envHint?: string;
}

const AKIT_REGISTRY: AkitTool[] = [
  { name: "web-search", description: "Search the web for current information", category: "search", mcp: { package: "@anthropic/web-search", command: "npx", args: ["-y", "@anthropic/web-search"] } },
  { name: "brave-search", description: "Private web search via Brave", category: "search", mcp: { package: "@modelcontextprotocol/server-brave-search", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], env: { BRAVE_API_KEY: "" } }, envHint: "Set BRAVE_API_KEY from https://brave.com/search/api/" },
  { name: "github", description: "Manage GitHub repos, PRs, issues", category: "development", mcp: { package: "@modelcontextprotocol/server-github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "" } }, envHint: "Set GITHUB_TOKEN from https://github.com/settings/tokens" },
  { name: "git", description: "Git operations — log, diff, blame, branch", category: "development", mcp: { package: "@modelcontextprotocol/server-git", command: "npx", args: ["-y", "@modelcontextprotocol/server-git"] } },
  { name: "filesystem", description: "Read, write, and search files", category: "development", mcp: { package: "@modelcontextprotocol/server-filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] } },
  { name: "linear", description: "Manage Linear issues and projects", category: "development", mcp: { package: "@linear/mcp-server", command: "npx", args: ["-y", "@linear/mcp-server"], env: { LINEAR_API_KEY: "" } }, envHint: "Set LINEAR_API_KEY from Linear settings → API" },
  { name: "sentry", description: "Monitor and triage app errors", category: "development", mcp: { package: "@sentry/mcp-server", command: "npx", args: ["-y", "@sentry/mcp-server"], env: { SENTRY_AUTH_TOKEN: "" } }, envHint: "Set SENTRY_AUTH_TOKEN from Sentry settings → API keys" },
  { name: "postgres", description: "Query PostgreSQL databases", category: "data", mcp: { package: "@modelcontextprotocol/server-postgres", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], env: { DATABASE_URL: "" } }, envHint: "Set DATABASE_URL (e.g., postgresql://user:pass@localhost/db)" },
  { name: "sqlite", description: "Query local SQLite databases", category: "data", mcp: { package: "@modelcontextprotocol/server-sqlite", command: "npx", args: ["-y", "@modelcontextprotocol/server-sqlite"] } },
  { name: "fetch", description: "HTTP requests to APIs", category: "automation", mcp: { package: "@modelcontextprotocol/server-fetch", command: "npx", args: ["-y", "@modelcontextprotocol/server-fetch"] } },
  { name: "puppeteer", description: "Browser automation and scraping", category: "automation", mcp: { package: "@modelcontextprotocol/server-puppeteer", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] } },
  { name: "docker", description: "Manage Docker containers", category: "automation", mcp: { package: "@modelcontextprotocol/server-docker", command: "npx", args: ["-y", "@modelcontextprotocol/server-docker"] } },
  { name: "slack", description: "Send and read Slack messages", category: "communication", mcp: { package: "@modelcontextprotocol/server-slack", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], env: { SLACK_BOT_TOKEN: "" } }, envHint: "Set SLACK_BOT_TOKEN from your Slack app settings" },
  { name: "notion", description: "Read and write Notion pages", category: "communication", mcp: { package: "@notionhq/notion-mcp-server", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], env: { NOTION_API_KEY: "" } }, envHint: "Set NOTION_API_KEY from https://notion.so/my-integrations" },
  { name: "social", description: "Post to Bluesky, X/Twitter, Threads", category: "communication", mcp: { package: "@aman_asmuei/aman-social", command: "npx", args: ["-y", "@aman_asmuei/aman-social"] }, envHint: "Set BLUESKY_HANDLE + BLUESKY_APP_PASSWORD, TWITTER_API_KEY + secrets, or THREADS_ACCESS_TOKEN" },
  { name: "memory", description: "Persistent AI memory via amem", category: "memory", mcp: { package: "@aman_asmuei/amem", command: "npx", args: ["-y", "@aman_asmuei/amem"] } },
  { name: "docling", description: "Convert PDF, DOCX, PPTX, XLSX to markdown", category: "documents", mcp: { package: "docling-mcp", command: "uvx", args: ["docling-mcp"] }, envHint: "Requires Python 3.10+. Install: pip install docling" },
];

interface InstalledTool {
  name: string;
  installedAt: string;
  mcpConfigured: boolean;
}

function loadAkitInstalled(): InstalledTool[] {
  const filePath = path.join(os.homedir(), ".akit", "installed.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return []; }
}

function saveAkitInstalled(tools: InstalledTool[]): void {
  const dir = path.join(os.homedir(), ".akit");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "installed.json"), JSON.stringify(tools, null, 2) + "\n", "utf-8");
}

function addToAmanAgentConfig(name: string, mcpConfig: { command: string; args: string[] }): void {
  const configPath = path.join(os.homedir(), ".aman-agent", "config.json");
  if (!fs.existsSync(configPath)) return;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers[name] = mcpConfig;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch { /* ignore */ }
}

function removeFromAmanAgentConfig(name: string): void {
  const configPath = path.join(os.homedir(), ".aman-agent", "config.json");
  if (!fs.existsSync(configPath)) return;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.mcpServers) {
      delete config.mcpServers[name];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
  } catch { /* ignore */ }
}

function handleAkitCommand(
  action: string | undefined,
  args: string[],
): CommandResult {
  const installed = loadAkitInstalled();
  const installedNames = new Set(installed.map(t => t.name));

  // /akit add [number|name|custom]
  if (action === "add") {
    const available = AKIT_REGISTRY.filter(t => !installedNames.has(t.name));

    // No argument — show numbered list
    if (args.length < 1) {
      if (available.length === 0) {
        return { handled: true, output: pc.green("All tools are installed!") };
      }
      const lines: string[] = [pc.bold("Select a tool to install:"), ""];
      available.forEach((tool, i) => {
        const num = pc.cyan(String(i + 1).padStart(2));
        lines.push(`  ${num}  ${tool.name.padEnd(16)} ${pc.dim(tool.description)}`);
      });
      lines.push("");
      lines.push(`  Type: ${pc.cyan("/akit add <number>")} or ${pc.cyan("/akit add <name>")}`);
      lines.push(`  Custom: ${pc.cyan("/akit add custom <name> <command> <args...>")}`);
      return { handled: true, output: lines.join("\n") };
    }

    // /akit add custom <name> <command> <args...>
    if (args[0].toLowerCase() === "custom") {
      if (args.length < 3) {
        return { handled: true, output: pc.yellow("Usage: /akit add custom <name> <command> <args...>\nExample: /akit add custom my-tool npx -y @org/my-mcp-server") };
      }
      const customName = args[1];
      const customCommand = args[2];
      const customArgs = args.slice(3);

      if (installedNames.has(customName)) {
        return { handled: true, output: pc.yellow(`${customName} is already installed.`) };
      }

      installed.push({
        name: customName,
        installedAt: new Date().toISOString().split("T")[0],
        mcpConfigured: true,
      });
      saveAkitInstalled(installed);
      addToAmanAgentConfig(customName, { command: customCommand, args: customArgs });

      return {
        handled: true,
        output: [
          pc.green(`✓ Added ${pc.bold(customName)}`) + pc.dim(` (custom MCP: ${customCommand} ${customArgs.join(" ")})`),
          pc.dim("  Restart aman-agent to load the new tool."),
        ].join("\n"),
      };
    }

    // Resolve by number or name
    const input = args[0].toLowerCase();
    let tool: AkitTool | undefined;

    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= available.length) {
      tool = available[num - 1];
    } else {
      tool = AKIT_REGISTRY.find(t => t.name === input);
    }

    if (!tool) {
      return {
        handled: true,
        output: [
          pc.red(`Tool "${input}" not found.`),
          `Type ${pc.cyan("/akit add")} to see available tools.`,
        ].join("\n"),
      };
    }

    if (installedNames.has(tool.name)) {
      return { handled: true, output: pc.yellow(`${tool.name} is already installed.`) };
    }

    // Install
    installed.push({
      name: tool.name,
      installedAt: new Date().toISOString().split("T")[0],
      mcpConfigured: tool.mcp !== null,
    });
    saveAkitInstalled(installed);

    if (tool.mcp) {
      addToAmanAgentConfig(tool.name, {
        command: tool.mcp.command,
        args: tool.mcp.args,
      });
    }

    const lines: string[] = [
      pc.green(`✓ Added ${pc.bold(tool.name)}`) + (tool.mcp ? pc.dim(` (MCP: ${tool.mcp.package})`) : ""),
    ];
    if (tool.envHint) {
      lines.push(pc.yellow(`  ⚠ ${tool.envHint}`));
    }
    if (tool.mcp) {
      lines.push(pc.dim("  Restart aman-agent to load the new tool."));
    }
    return { handled: true, output: lines.join("\n") };
  }

  // /akit remove <tool>
  if (action === "remove") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /akit remove <tool>") };
    }
    const toolName = args[0].toLowerCase();

    if (!installedNames.has(toolName)) {
      return { handled: true, output: pc.red(`${toolName} is not installed.`) };
    }

    // Remove from installed.json
    const updated = installed.filter(t => t.name !== toolName);
    saveAkitInstalled(updated);

    // Remove from aman-agent config
    removeFromAmanAgentConfig(toolName);

    return {
      handled: true,
      output: pc.green(`✓ Removed ${pc.bold(toolName)}`) + pc.dim("  (restart aman-agent to apply)"),
    };
  }

  // /akit help
  if (action === "help") {
    return {
      handled: true,
      output: [
        pc.bold("akit — Tool Management"),
        "",
        `  ${pc.cyan("/akit")}               List installed & available tools`,
        `  ${pc.cyan("/akit add <tool>")}     Install a tool`,
        `  ${pc.cyan("/akit remove <tool>")}  Uninstall a tool`,
      ].join("\n"),
    };
  }

  // Default: /akit — show installed + available
  const available = AKIT_REGISTRY.filter(t => !installedNames.has(t.name));

  const lines: string[] = [pc.bold("akit — AI Tool Manager"), ""];

  // Installed section
  if (installed.length > 0) {
    lines.push(`  ${pc.bold(`Installed (${installed.length})`)}`);
    for (const tool of installed) {
      const mcp = tool.mcpConfigured ? pc.green("MCP") : pc.dim("manual");
      lines.push(`  ${pc.green("●")} ${pc.bold(tool.name.padEnd(16))} ${mcp}  ${pc.dim(tool.installedAt)}`);
    }
    lines.push("");
  }

  // Available section
  if (available.length > 0) {
    lines.push(`  ${pc.bold(`Available (${available.length})`)}`);
    const byCategory = new Map<string, AkitTool[]>();
    for (const tool of available) {
      if (!byCategory.has(tool.category)) byCategory.set(tool.category, []);
      byCategory.get(tool.category)!.push(tool);
    }
    for (const [category, tools] of byCategory) {
      lines.push(`  ${pc.dim(category)}`);
      for (const tool of tools) {
        lines.push(`  ${pc.dim("○")} ${tool.name.padEnd(16)} ${pc.dim(tool.description)}`);
      }
    }
    lines.push("");
  }

  lines.push(`  ${pc.cyan("/akit add <tool>")}     Install a tool`);
  lines.push(`  ${pc.cyan("/akit remove <tool>")}  Uninstall a tool`);

  return { handled: true, output: lines.join("\n") };
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
  return { handled: true, output: pc.yellow(`Unknown action: /skills ${action}. Use /skills [install|uninstall].`) };
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
  return { handled: true, output: pc.yellow(`Unknown action: /eval ${action}. Use /eval or /eval milestone <text>.`) };
}

async function handleMemoryCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    // Default: show recent memory context via MCP
    if (!ctx.mcpManager) {
      return {
        handled: true,
        output: pc.red("Memory not available: aman-mcp not connected. Start it with: npx @aman_asmuei/aman-mcp"),
      };
    }
    const result = await ctx.mcpManager.callTool("memory_context", { topic: "recent context" });
    if (result.startsWith("Error")) {
      return { handled: true, output: pc.red(result) };
    }
    return { handled: true, output: result };
  }
  // /memory <topic> — shortcut for context on a specific topic
  if (action && !["search", "clear", "timeline"].includes(action)) {
    if (!ctx.mcpManager) {
      return { handled: true, output: pc.red("Memory not available: MCP not connected.") };
    }
    const topic = [action, ...args].join(" ");
    const result = await ctx.mcpManager.callTool("memory_context", { topic });
    if (result.startsWith("Error")) {
      return { handled: true, output: pc.red(result) };
    }
    return { handled: true, output: result };
  }
  if (action === "search") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory search <query...>") };
    }
    const query = args.join(" ");
    const output = await mcpWrite(ctx, "memory", "memory_recall", { query });
    return { handled: true, output };
  }
  if (action === "clear") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory clear <category>") };
    }
    const output = await mcpWrite(ctx, "memory", "memory_forget", { category: args[0] });
    return { handled: true, output };
  }
  if (action === "timeline") {
    if (!ctx.mcpManager) {
      return { handled: true, output: pc.red("Memory not available: MCP not connected.") };
    }
    try {
      const result = await ctx.mcpManager.callTool("memory_recall", { query: "*", limit: 500 });
      if (result.startsWith("Error") || result.includes("No memories found")) {
        return { handled: true, output: pc.dim("No memories yet. Start chatting and I'll remember what matters.") };
      }
      try {
        const memories = JSON.parse(result);
        if (Array.isArray(memories) && memories.length > 0) {
          const byDate = new Map<string, number>();
          for (const mem of memories) {
            const date = mem.created_at
              ? new Date(mem.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
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
            if (Array.isArray(mem.tags)) {
              for (const tag of mem.tags) {
                tags.set(tag, (tags.get(tag) || 0) + 1);
              }
            }
          }
          lines.push("");
          lines.push(`  Total: ${memories.length} memories`);
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
      } catch { /* Non-JSON response */ }
      const lineCount = result.split("\n").filter((l: string) => l.trim()).length;
      return { handled: true, output: `Total memories: ~${lineCount} entries.` };
    } catch {
      return { handled: true, output: pc.red("Failed to retrieve memory timeline.") };
    }
  }
  return { handled: true, output: pc.yellow(`Unknown action: /memory ${action}. Use /memory [search|clear|timeline].`) };
}

function handleStatusCommand(ctx: CommandContext): CommandResult {
  const mcpToolCount = ctx.mcpManager ? ctx.mcpManager.getTools().length : 0;
  const amemConnected = mcpToolCount > 0; // simplified check
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
  const amemConnected = mcpToolCount > 0;
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
    lines.push(`    ${pc.dim("→ Fix: npx @aman_asmuei/amem")}`);
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
      `  ${pc.cyan("/skills")}       View skills [install|uninstall ...]`,
      `  ${pc.cyan("/eval")}         View evaluation [milestone ...]`,
      `  ${pc.cyan("/memory")}       View recent memories [search|clear|timeline]`,
      `  ${pc.cyan("/status")}       Ecosystem dashboard`,
      `  ${pc.cyan("/doctor")}       Health check all layers`,
      `  ${pc.cyan("/decisions")}    View decision log [<project>]`,
      `  ${pc.cyan("/export")}       Export conversation to markdown`,
      `  ${pc.cyan("/debug")}        Show debug log`,
      `  ${pc.cyan("/save")}         Save conversation to memory`,
      `  ${pc.cyan("/model")}        Show current LLM model`,
      `  ${pc.cyan("/update")}       Check for updates`,
      `  ${pc.cyan("/reconfig")}     Reset LLM config`,
      `  ${pc.cyan("/clear")}        Clear conversation history`,
      `  ${pc.cyan("/quit")}         Exit`,
    ].join("\n"),
  };
}

function handleSave(): CommandResult {
  return { handled: true, saveConversation: true };
}

function handleReconfig(): CommandResult {
  const configDir = path.join(os.homedir(), ".aman-agent");
  const configPath = path.join(configDir, "config.json");
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
  // Write marker to skip auto-detect on next run → force interactive prompt
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, ".reconfig"), "", "utf-8");
  return {
    handled: true,
    quit: true,
    output: [
      pc.green("Config reset."),
      "Next run will prompt you to choose your LLM provider.",
    ].join("\n"),
  };
}

function handleUpdate(): CommandResult {
  try {
    const current = execFileSync("npm", ["view", "@aman_asmuei/aman-agent", "version"], { encoding: "utf-8" }).trim();
    const local = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).version;
    if (current === local) {
      return { handled: true, output: `${pc.green("Up to date")} — v${local}` };
    }
    return {
      handled: true,
      output: [
        `${pc.yellow("Update available:")} v${local} → v${current}`,
        "",
        `Run this in your terminal:`,
        `  ${pc.bold("npm install -g @aman_asmuei/aman-agent@latest")}`,
        "",
        `Or use npx (always latest):`,
        `  ${pc.bold("npx @aman_asmuei/aman-agent@latest")}`,
      ].join("\n"),
    };
  } catch {
    return {
      handled: true,
      output: [
        `To update, run in your terminal:`,
        `  ${pc.bold("npm install -g @aman_asmuei/aman-agent@latest")}`,
        "",
        `Or use npx (always latest):`,
        `  ${pc.bold("npx @aman_asmuei/aman-agent@latest")}`,
      ].join("\n"),
    };
  }
}

async function handleDecisionsCommand(
  action: string | undefined,
  _args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!ctx.mcpManager) {
    return { handled: true, output: pc.red("Decisions not available: MCP not connected.") };
  }
  const scope = action || undefined;
  const result = await ctx.mcpManager.callTool("memory_recall", {
    query: "decision",
    type: "decision",
    limit: 20,
    ...(scope ? { scope } : {}),
  });
  if (result.startsWith("Error")) {
    return { handled: true, output: pc.red(result) };
  }
  return { handled: true, output: pc.bold("Decision Log:\n") + result };
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

// --- Delegation ---

async function handleDelegateCommand(action: string | undefined, args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (!action) {
    return { handled: true, output: `Delegate commands:
  /delegate <profile> <task>        Delegate a task to a profile
  /delegate pipeline <p1> <p2> ...  Run a sequential pipeline
  /delegate help                    Show help

Examples:
  /delegate writer Write a blog post about AI companions
  /delegate coder Review this code for security issues
  /delegate pipeline writer,researcher Write and fact-check an article about quantum computing` };
  }

  if (action === "help") {
    return { handled: true, output: `Delegate a task to a sub-agent with a specific profile.

The sub-agent runs with its own identity, rules, and skills but shares
your memory and tools. Results come back to you.

Usage:
  /delegate <profile> <task>
  /delegate pipeline <profile1>,<profile2> <task>

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

// --- Profile management ---

function handleProfileCommand(action: string | undefined, args: string[]): CommandResult {
  const profilesDir = path.join(os.homedir(), ".acore", "profiles");

  if (!action || action === "list") {
    const profiles = listProfiles();
    if (profiles.length === 0) {
      return { handled: true, output: pc.dim("No profiles yet. Create one with: /profile create <name>") };
    }
    const lines = profiles.map((p) =>
      `  ${pc.bold(p.name)} — ${p.aiName} (${pc.dim(p.personality)})`
    );
    return { handled: true, output: "Profiles:\n" + lines.join("\n") + "\n\n" + pc.dim("Switch with: aman-agent --profile <name>") };
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
  /profile              List all profiles
  /profile create <n>   Create new profile
  /profile show <n>     Show profile files
  /profile delete <n>   Delete a profile

  Use profiles:
  aman-agent --profile <name>
  AMAN_PROFILE=<name> aman-agent` };

    default:
      return { handled: true, output: pc.yellow(`Unknown profile action: ${action}. Try /profile help`) };
  }
}

// --- Plan management ---

function handlePlanCommand(action: string | undefined, args: string[]): CommandResult {
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

      if (args.length > 0) {
        const stepNum = parseInt(args[0], 10);
        if (isNaN(stepNum) || stepNum < 1 || stepNum > active.steps.length) {
          return { handled: true, output: pc.yellow(`Invalid step number. Range: 1-${active.steps.length}`) };
        }
        markStepDone(active, stepNum - 1);
        return { handled: true, output: pc.green(`Step ${stepNum} done!`) + "\n\n" + formatPlan(active) };
      }

      // No step specified — mark next incomplete step
      const next = active.steps.findIndex((s) => !s.done);
      if (next < 0) return { handled: true, output: pc.green("All steps already complete!") };
      markStepDone(active, next);
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

const KNOWN_COMMANDS = new Set([
  "quit", "exit", "q", "help", "clear", "model", "identity", "rules",
  "workflows", "tools", "akit", "skills", "eval", "memory", "status", "doctor",
  "save", "decisions", "export", "debug", "update-config", "reconfig",
  "update", "upgrade", "plan", "profile", "delegate",
]);

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
    case "update-config":
    case "reconfig":
      return handleReconfig();
    case "plan":
      return handlePlanCommand(action, args);
    case "profile":
      return handleProfileCommand(action, args);
    case "delegate":
      return handleDelegateCommand(action, args, ctx);
    case "update":
    case "upgrade":
      return handleUpdate();
    default:
      return { handled: false }; // Pass to LLM if not matched
  }
}
