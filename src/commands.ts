import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import pc from "picocolors";

export interface CommandResult {
  handled: boolean;
  output?: string;
  quit?: boolean;
  clearHistory?: boolean;
  remind?: { timeStr: string; message: string };
}

function readEcosystemFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    return pc.dim(`No ${label} file found at ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8").trim();
}

export function handleCommand(input: string, model?: string): CommandResult {
  const cmd = input.trim().toLowerCase();
  const home = os.homedir();

  if (cmd === "/quit" || cmd === "/exit" || cmd === "/q") {
    return { handled: true, quit: true };
  }

  if (cmd === "/help") {
    return {
      handled: true,
      output: [
        pc.bold("Commands:"),
        `  ${pc.cyan("/help")}       Show this help`,
        `  ${pc.cyan("/identity")}   View your AI identity`,
        `  ${pc.cyan("/tools")}      View installed tools`,
        `  ${pc.cyan("/workflows")}  View defined workflows`,
        `  ${pc.cyan("/rules")}      View guardrails`,
        `  ${pc.cyan("/skills")}     View installed skills`,
        `  ${pc.cyan("/remind")}     Set a reminder (e.g. /remind 30m Review PR)`,
        `  ${pc.cyan("/model")}      Show current LLM model`,
        `  ${pc.cyan("/update")}     Check for updates`,
        `  ${pc.cyan("/reconfig")}   Reset LLM config (provider, model, API key)`,
        `  ${pc.cyan("/clear")}      Clear conversation history`,
        `  ${pc.cyan("/quit")}       Exit`,
      ].join("\n"),
    };
  }

  if (cmd === "/identity") {
    const content = readEcosystemFile(
      path.join(home, ".acore", "core.md"),
      "identity (acore)",
    );
    return { handled: true, output: content };
  }

  if (cmd === "/tools") {
    const content = readEcosystemFile(
      path.join(home, ".akit", "kit.md"),
      "tools (akit)",
    );
    return { handled: true, output: content };
  }

  if (cmd === "/workflows") {
    const content = readEcosystemFile(
      path.join(home, ".aflow", "flow.md"),
      "workflows (aflow)",
    );
    return { handled: true, output: content };
  }

  if (cmd === "/rules") {
    const content = readEcosystemFile(
      path.join(home, ".arules", "rules.md"),
      "guardrails (arules)",
    );
    return { handled: true, output: content };
  }

  if (cmd === "/skills") {
    const content = readEcosystemFile(
      path.join(home, ".askill", "skills.md"),
      "skills (askill)",
    );
    return { handled: true, output: content };
  }

  if (cmd === "/model") {
    return {
      handled: true,
      output: model ? `Model: ${pc.bold(model)}` : "Model: unknown",
    };
  }

  if (cmd === "/update-config" || cmd === "/reconfig") {
    const configPath = path.join(os.homedir(), ".aman-agent", "config.json");
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    return {
      handled: true,
      quit: true,
      output: [
        pc.green("Config reset."),
        `Run ${pc.bold("npx @aman_asmuei/aman-agent")} again to reconfigure your LLM provider, model, and API key.`,
      ].join("\n"),
    };
  }

  if (cmd === "/update" || cmd === "/upgrade") {
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

  if (cmd === "/clear") {
    return { handled: true, output: pc.dim("Conversation cleared."), clearHistory: true };
  }

  if (cmd.startsWith("/remind")) {
    const parts = input.trim().split(/\s+/);
    if (parts.length < 3) {
      return {
        handled: true,
        output:
          "Usage: /remind <time> <message>\nExamples: /remind 30m Review PR, /remind 2h Deploy, /remind tomorrow Check metrics",
      };
    }
    const timeStr = parts[1];
    const message = parts.slice(2).join(" ");
    return { handled: true, remind: { timeStr, message } };
  }

  if (cmd.startsWith("/")) {
    return {
      handled: true,
      output: `Unknown command: ${cmd}. Type ${pc.cyan("/help")} for available commands.`,
    };
  }

  return { handled: false };
}
