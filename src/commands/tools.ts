import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import { handleAkitCommand } from "./akit.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handleToolsCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action || action === "list") {
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
