import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import type { McpManager } from "./mcp/client.js";
import { getEcosystemStatus } from "./layers/parsers.js";

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

async function handleToolsCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".akit", "kit.md"), "tools (akit)");
    return { handled: true, output: content };
  }
  if (action === "add") {
    if (args.length < 3) {
      return { handled: true, output: pc.yellow("Usage: /tools add <name> <type> <description...>") };
    }
    const name = args[0];
    const type = args[1];
    const description = args.slice(2).join(" ");
    const output = await mcpWrite(ctx, "tools", "tools_add", { name, type, description });
    return { handled: true, output };
  }
  if (action === "remove") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /tools remove <name>") };
    }
    const output = await mcpWrite(ctx, "tools", "tools_remove", { name: args.join(" ") });
    return { handled: true, output };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /tools ${action}. Use /tools [add|remove].`) };
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
    const result = await ctx.mcpManager.callTool("memory_context", {});
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
      `  ${pc.cyan("/tools")}        View tools [add|remove ...]`,
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

const KNOWN_COMMANDS = new Set([
  "quit", "exit", "q", "help", "clear", "model", "identity", "rules",
  "workflows", "tools", "skills", "eval", "memory", "status", "doctor",
  "save", "decisions", "export", "debug", "update-config", "reconfig",
  "update", "upgrade",
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
      return handleToolsCommand(action, args, ctx);
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
    case "update":
    case "upgrade":
      return handleUpdate();
    default:
      return { handled: false }; // Pass to LLM if not matched
  }
}
