import pc from "picocolors";
import type { CommandContext, CommandResult } from "./shared.js";
import {
  listWorkspaces,
  archiveWorkspace,
  unarchiveWorkspace,
  setNotes,
  forgetWorkspace,
} from "../workspaces/tracker.js";

const USAGE = `Usage:
  /workspaces                  list active, newest first
  /workspaces all              include archived
  /workspaces archive <name>   manually archive
  /workspaces unarchive <name> re-activate
  /workspaces notes <name> <text...>  set/clear notes (empty text clears)
  /workspaces forget <name>    hard-remove`;

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "1d";
  if (d < 30) return `${d}d`;
  const m = Math.floor(d / 30);
  return `${m}mo`;
}

export async function handleWorkspacesCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  try {
    if (!action || action === "list") {
      const list = await listWorkspaces();
      if (list.length === 0) {
        return {
          handled: true,
          output: pc.dim("No workspaces tracked yet."),
        };
      }
      const lines = list.map(
        (w) =>
          `  ${pc.bold(w.name)}  ${pc.dim(ageOf(w.lastSeen))}  ${pc.dim(
            w.path,
          )}${w.notes ? `\n    ${pc.dim("notes: " + w.notes)}` : ""}`,
      );
      return {
        handled: true,
        output: `Active workspaces (${list.length}/7):\n${lines.join("\n")}`,
      };
    }

    if (action === "all") {
      const list = await listWorkspaces({ includeArchived: true });
      if (list.length === 0) {
        return {
          handled: true,
          output: pc.dim("No workspaces tracked yet."),
        };
      }
      const lines = list.map((w) => {
        const marker = w.archived ? pc.dim("[archived]  ") : "";
        return `  ${marker}${pc.bold(w.name)}  ${pc.dim(
          ageOf(w.lastSeen),
        )}  ${pc.dim(w.path)}`;
      });
      return {
        handled: true,
        output: `All workspaces (${list.length}):\n${lines.join("\n")}`,
      };
    }

    if (action === "archive") {
      const name = args[0];
      if (!name) {
        return { handled: true, output: USAGE };
      }
      await archiveWorkspace(name);
      return { handled: true, output: `Archived: ${name}` };
    }

    if (action === "unarchive") {
      const name = args[0];
      if (!name) return { handled: true, output: USAGE };
      await unarchiveWorkspace(name);
      return { handled: true, output: `Unarchived (now active): ${name}` };
    }

    if (action === "notes") {
      const name = args[0];
      if (!name) return { handled: true, output: USAGE };
      const text = args.slice(1).join(" ");
      await setNotes(name, text);
      return {
        handled: true,
        output: text === ""
          ? `Cleared notes for: ${name}`
          : `Set notes for: ${name}`,
      };
    }

    if (action === "forget") {
      const name = args[0];
      if (!name) return { handled: true, output: USAGE };
      await forgetWorkspace(name);
      return { handled: true, output: `Forgot: ${name} (entry removed)` };
    }

    return {
      handled: true,
      output: `Unknown action: "${action}"\n${USAGE}`,
    };
  } catch (err) {
    return {
      handled: true,
      output: pc.red(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
}
