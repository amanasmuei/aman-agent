import pc from "picocolors";
import { readFile, listFiles } from "../files.js";
import type { CommandResult } from "./shared.js";

export async function handleFileCommand(
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
        pc.bold(`\ud83d\udcc4 ${result.path}`) + pc.dim(` (${(result.size / 1024).toFixed(1)} KB)`),
        "",
        result.content,
      ];
      if (result.truncated) {
        lines.push("", pc.yellow(`\u26a0 File truncated at 50 KB. Use a text editor for the full file.`));
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
        pc.bold(`\ud83d\udcc1 ${result.path}`) + pc.dim(` (${result.total} items)`),
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
