import pc from "picocolors";
import {
  reminderSet,
  reminderList,
  reminderCheck,
  reminderComplete,
} from "../memory.js";
import type { CommandResult } from "./shared.js";

export async function handleReminderCommand(
  action: string | undefined,
  args: string[],
): Promise<CommandResult> {
  if (!action || action === "list") {
    try {
      const reminders = reminderList();
      if (reminders.length === 0) return { handled: true, output: pc.dim("No reminders.") };
      const lines: string[] = [pc.bold(`Reminders (${reminders.length}):`), ""];
      for (const r of reminders) {
        const status = r.completed ? pc.green("[done]") : pc.yellow("[todo]");
        const due = r.dueAt ? ` ${pc.dim(`due: ${new Date(r.dueAt).toLocaleString()}`)}` : "";
        lines.push(`  ${status} ${r.content}${due} ${pc.dim(`(${r.id.slice(0, 8)})`)}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "set" || action === "add") {
    if (args.length === 0) return { handled: true, output: pc.yellow("Usage: /reminder set <text> [--due <time>]\n  Time formats: 1h, 2d, 1w, or ISO date (2026-04-10)") };
    let dueAt: number | undefined;
    const dueIdx = args.indexOf("--due");
    let contentArgs = args;
    if (dueIdx >= 0 && args[dueIdx + 1]) {
      const dueStr = args[dueIdx + 1];
      contentArgs = [...args.slice(0, dueIdx), ...args.slice(dueIdx + 2)];
      const relMatch = dueStr.match(/^(\d+)(h|d|w)$/);
      if (relMatch) {
        const num = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const ms = unit === "h" ? num * 3600000 : unit === "d" ? num * 86400000 : num * 604800000;
        dueAt = Date.now() + ms;
      } else {
        const parsed = Date.parse(dueStr);
        if (!isNaN(parsed)) dueAt = parsed;
      }
    }
    const content = contentArgs.join(" ");
    if (!content) return { handled: true, output: pc.yellow("Usage: /reminder set <text> [--due <time>]") };
    try {
      const id = reminderSet(content, dueAt);
      const dueInfo = dueAt ? ` (due: ${new Date(dueAt).toLocaleDateString()})` : "";
      return { handled: true, output: pc.green(`Reminder set: "${content}"${dueInfo} (ID: ${id.slice(0, 8)})`) };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "done" || action === "complete") {
    if (!args[0]) return { handled: true, output: pc.yellow("Usage: /reminder done <id>") };
    try {
      const result = reminderComplete(args[0]);
      return { handled: true, output: result ? pc.green("Reminder completed.") : pc.yellow("Reminder not found.") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "check") {
    try {
      const reminders = reminderCheck();
      if (reminders.length === 0) return { handled: true, output: pc.dim("No pending reminders.") };
      const lines: string[] = [pc.bold("Pending Reminders:"), ""];
      for (const r of reminders) {
        const icon = r.status === "overdue" ? pc.red("!!!") : r.status === "today" ? pc.yellow("(!)") : pc.dim("( )");
        const due = r.dueAt ? ` ${pc.dim(`due: ${new Date(r.dueAt).toLocaleString()}`)}` : "";
        lines.push(`  ${icon} ${r.content}${due} ${pc.dim(`[${r.status}]`)}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reminder error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Reminder commands:"),
      `  ${pc.cyan("/reminder")}                List all reminders`,
      `  ${pc.cyan("/reminder set")} <text>      Create a reminder [--due 1h|2d|1w|date]`,
      `  ${pc.cyan("/reminder check")}           Show overdue/upcoming`,
      `  ${pc.cyan("/reminder done")} <id>       Mark as completed`,
    ].join("\n") };
  }

  return { handled: true, output: pc.yellow(`Unknown action: /reminder ${action}. Try /reminder --help`) };
}
