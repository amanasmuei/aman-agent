import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import {
  readEcosystemFile,
  mcpWrite,
  type CommandContext,
  type CommandResult,
} from "./shared.js";

export async function handleWorkflowsCommand(
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
