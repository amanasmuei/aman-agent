declare const __VERSION__: string;

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import { memoryRecall } from "../memory.js";
import type { CommandContext, CommandResult } from "./shared.js";

export function handleHelp(): CommandResult {
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

export function handleSave(): CommandResult {
  return { handled: true, saveConversation: true };
}

export function handleReset(action: string | undefined): CommandResult {
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
        `  ${pc.cyan("/reset all")}        Full reset \u2014 config, memory, identity, rules`,
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

  if (targets.includes("config")) {
    const configDir = dirs.config;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, ".reconfig"), "", "utf-8");
  }

  if (removed.length === 0) {
    return { handled: true, output: pc.dim("Nothing to reset \u2014 directories don't exist.") };
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

export function handleUpdate(): CommandResult {
  try {
    const current = execFileSync("npm", ["view", "@aman_asmuei/aman-agent", "version"], { encoding: "utf-8" }).trim();
    const local = typeof __VERSION__ !== "undefined" ? __VERSION__ : "unknown";
    if (current === local) {
      return { handled: true, output: `${pc.green("Up to date")} \u2014 v${local}` };
    }
    const isVendored = process.execPath.includes(path.join(".aman-agent", "node"));
    const updateCmd = isVendored
      ? "aman-agent update"
      : "npm install -g @aman_asmuei/aman-agent@latest";

    return {
      handled: true,
      output: [
        `${pc.yellow("Update available:")} v${local} \u2192 v${current}`,
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

export async function handleDecisionsCommand(
  _action: string | undefined,
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

export function handleExportCommand(): CommandResult {
  return { handled: true, exportConversation: true };
}

export function handleDebugCommand(): CommandResult {
  const logPath = path.join(os.homedir(), ".aman-agent", "debug.log");
  if (!fs.existsSync(logPath)) {
    return { handled: true, output: pc.dim("No debug log found.") };
  }
  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.trim().split("\n");
  const last20 = lines.slice(-20).join("\n");
  return { handled: true, output: pc.bold("Debug Log (last 20 entries):\n") + pc.dim(last20) };
}
