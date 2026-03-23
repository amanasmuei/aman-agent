import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";

export interface CommandResult {
  handled: boolean;
  output?: string;
  quit?: boolean;
  clearHistory?: boolean;
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
        `  ${pc.cyan("/model")}      Show current LLM model`,
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

  if (cmd === "/clear") {
    return { handled: true, output: pc.dim("Conversation cleared."), clearHistory: true };
  }

  if (cmd.startsWith("/")) {
    return {
      handled: true,
      output: `Unknown command: ${cmd}. Type ${pc.cyan("/help")} for available commands.`,
    };
  }

  return { handled: false };
}
