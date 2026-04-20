import pc from "picocolors";
import type { CommandResult } from "./shared.js";

// ── /akit slash command ─────────────────────────────────────────────────────
//
// Per engine v1 D4: akit is DORMANT — stays as the standalone CLI tool
// installer, and aman-agent no longer reimplements its registry. This /akit
// slash command is informational, pointing the user at the canonical CLI.
export function handleAkitCommand(
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
