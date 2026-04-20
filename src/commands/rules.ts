import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import {
  listRuleCategories as arulesListCategories,
  addRule as arulesAddRule,
  removeRule as arulesRemoveRule,
  toggleRuleAt as arulesToggleRule,
  checkAction as arulesCheckAction,
} from "@aman_asmuei/arules-core";
import {
  AGENT_SCOPE,
  type CommandContext,
  type CommandResult,
} from "./shared.js";

function suggestionsPath(): string {
  return path.join(os.homedir(), ".arules", AGENT_SCOPE.replace(":", "/"), "suggestions.md");
}

function readSuggestionsSource(): string {
  const p = suggestionsPath();
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

function writeSuggestionsSource(source: string): void {
  const p = suggestionsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, source, { mode: 0o600 });
}

export async function handleRulesCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    const cats = await arulesListCategories(AGENT_SCOPE);
    if (cats.length === 0) {
      return {
        handled: true,
        output: pc.dim(
          `No rules configured for ${AGENT_SCOPE}. Run: npx @aman_asmuei/arules`,
        ),
      };
    }
    const lines: string[] = [];
    for (const cat of cats) {
      lines.push(pc.bold(`## ${cat.name}`));
      for (const rule of cat.rules) {
        lines.push(`  - ${rule}`);
      }
      lines.push("");
    }
    return { handled: true, output: lines.join("\n").trim() };
  }
  if (action === "add") {
    if (args.length < 2) {
      return {
        handled: true,
        output: pc.yellow("Usage: /rules add <category> <rule text...>"),
      };
    }
    const category = args[0];
    const rule = args.slice(1).join(" ");
    try {
      await arulesAddRule(category, rule, AGENT_SCOPE);
      return {
        handled: true,
        output: pc.green(`Added rule to "${category}": ${rule}`),
      };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
  if (action === "remove") {
    if (args.length < 2) {
      return {
        handled: true,
        output: pc.yellow("Usage: /rules remove <category> <index>"),
      };
    }
    const category = args[0];
    const idx = parseInt(args[1], 10);
    if (isNaN(idx) || idx < 1) {
      return {
        handled: true,
        output: pc.yellow("Index must be a positive integer."),
      };
    }
    try {
      await arulesRemoveRule(category, idx, AGENT_SCOPE);
      return {
        handled: true,
        output: pc.green(`Removed rule ${idx} from "${category}"`),
      };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
  if (action === "toggle") {
    if (args.length < 2) {
      return {
        handled: true,
        output: pc.yellow("Usage: /rules toggle <category> <index>"),
      };
    }
    const category = args[0];
    const idx = parseInt(args[1], 10);
    if (isNaN(idx) || idx < 1) {
      return {
        handled: true,
        output: pc.yellow("Index must be a positive integer."),
      };
    }
    try {
      await arulesToggleRule(category, idx, AGENT_SCOPE);
      return {
        handled: true,
        output: pc.green(`Toggled rule ${idx} in "${category}"`),
      };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
  if (action === "check") {
    if (args.length === 0) {
      return { handled: true, output: pc.yellow("Usage: /rules check <action description...>") };
    }
    const description = args.join(" ");
    try {
      const result = await arulesCheckAction(description, AGENT_SCOPE);
      if (result.safe) {
        return { handled: true, output: pc.green(`Action is allowed: "${description}"`) };
      }
      return {
        handled: true,
        output: pc.red(`Action blocked: "${description}"\nViolations:\n${result.violations.map(v => `  - ${v}`).join("\n")}`),
      };
    } catch (err) {
      return { handled: true, output: pc.red(`Check error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "review") {
    const wantList = args.includes("--list");
    const source = readSuggestionsSource();
    const entries = parseSuggestions(source).filter((e) => e.status === "pending");

    if (entries.length === 0) {
      return { handled: true, output: pc.dim("No pending rule suggestions.") };
    }

    if (wantList) {
      const lines = [pc.bold(`${entries.length} pending`), ""];
      entries.forEach((e, i) => {
        lines.push(
          `  [${i + 1}] ${pc.cyan(e.heading)}`,
          `      Phrase: ${e.phrase}`,
          `      Occurrences: ${e.occurrences}${e.explicit ? " (explicit)" : ""} · Category: ${e.category}`,
        );
      });
      lines.push("", pc.dim("Run /rules review without --list to interactively accept/reject."));
      return { handled: true, output: lines.join("\n") };
    }

    // For v3.2.0-alpha: --list + /rules accept|reject <n> only.
    // Full readline interactive loop lands in v3.2.0-beta.
    return {
      handled: true,
      output: pc.yellow(
        "Use /rules review --list to see pending suggestions, then /rules accept <n> or /rules reject <n>.",
      ),
    };
  }

  if (action === "accept" || action === "reject") {
    const idx = parseInt(args[0], 10);
    if (isNaN(idx) || idx < 1) {
      return { handled: true, output: pc.yellow(`Usage: /rules ${action} <number-from-review-list>`) };
    }
    const source = readSuggestionsSource();
    const entries = parseSuggestions(source).filter((e) => e.status === "pending");
    const entry = entries[idx - 1];
    if (!entry) {
      return { handled: true, output: pc.red(`No pending suggestion #${idx}`) };
    }
    if (action === "accept") {
      try {
        await arulesAddRule(entry.category, entry.phrase, AGENT_SCOPE);
        writeSuggestionsSource(acceptSuggestion(source, entry));
        return { handled: true, output: pc.green(`\u2713 Added to ${entry.category}: "${entry.phrase}"`) };
      } catch (err) {
        return { handled: true, output: pc.red(`Failed: ${err instanceof Error ? err.message : String(err)}`) };
      }
    }
    // reject
    writeSuggestionsSource(rejectSuggestion(source, entry));
    const rejectedFile = path.join(path.dirname(suggestionsPath()), ".rejected-hashes");
    fs.appendFileSync(rejectedFile, phraseHash(entry.phrase) + "\n", { mode: 0o600 });
    return { handled: true, output: pc.dim(`\u2717 Rejected (won't surface again).`) };
  }

  if (action === "help") {
    return {
      handled: true,
      output: [
        pc.bold("Rules commands:"),
        `  ${pc.cyan("/rules")}                         View current rules`,
        `  ${pc.cyan("/rules add")} <category> <text>    Add a rule`,
        `  ${pc.cyan("/rules remove")} <category> <idx>  Remove a rule`,
        `  ${pc.cyan("/rules toggle")} <category> <idx>  Toggle a rule`,
        `  ${pc.cyan("/rules check")} <action...>         Check if an action is allowed`,
        `  ${pc.cyan("/rules review")}                View pending rule suggestions from observer`,
        `  ${pc.cyan("/rules accept")} <n>            Accept suggestion #n (from review list)`,
        `  ${pc.cyan("/rules reject")} <n>            Reject suggestion #n (won't resurface)`,
      ].join("\n"),
    };
  }
  return {
    handled: true,
    output: pc.yellow(`Unknown action: /rules ${action}. Try /rules --help`),
  };
}

export interface SuggestionEntry {
  heading: string;
  phrase: string;
  occurrences: number;
  explicit: boolean;
  firstSeen?: string;
  category: string;
  status: "pending" | "accepted" | "rejected";
  rawBlockStart: number;
  rawBlockEnd: number;
}

export function parseSuggestions(source: string): SuggestionEntry[] {
  if (!source.trim()) return [];
  const lines = source.split("\n");
  const entries: SuggestionEntry[] = [];

  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("## ")) {
      const blockStart = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      const heading = lines[i].slice(3).trim();
      const fields: Record<string, string> = {};
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith("## ")) {
        const m = lines[j].match(/^-\s+([^:]+):\s*(.*)$/);
        if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
        j++;
      }
      const blockEnd = lines.slice(0, j).join("\n").length;

      const phrase = fields["phrase"];
      const statusRaw = fields["status"] ?? "";
      const status: SuggestionEntry["status"] = statusRaw.startsWith("accepted")
        ? "accepted"
        : statusRaw.startsWith("rejected")
        ? "rejected"
        : "pending";
      const occRaw = fields["occurrences"] ?? "";
      const occMatch = occRaw.match(/^(\d+)/);
      const occurrences = occMatch ? parseInt(occMatch[1], 10) : 0;
      const explicit = /explicit marker/i.test(occRaw);
      const category =
        fields["category (used)"] ??
        fields["category (suggested)"] ??
        "general";

      if (phrase && statusRaw) {
        entries.push({
          heading,
          phrase,
          occurrences,
          explicit,
          firstSeen: fields["first seen"],
          category,
          status,
          rawBlockStart: blockStart,
          rawBlockEnd: blockEnd,
        });
      }
      i = j;
    } else {
      i++;
    }
  }
  return entries;
}

function formatTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function acceptSuggestion(
  source: string,
  entry: SuggestionEntry,
  now: Date = new Date(),
  editedPhrase?: string,
  editedCategory?: string,
): string {
  const block = source.slice(entry.rawBlockStart, entry.rawBlockEnd);
  const lines = block.split("\n");
  const newLines: string[] = [];
  const ts = formatTs(now);

  let insertedOriginal = false;
  for (const ln of lines) {
    if (editedPhrase && !insertedOriginal && /^- Phrase:/.test(ln)) {
      newLines.push(`- Original: ${entry.phrase}`);
      newLines.push(`- Phrase: ${editedPhrase}`);
      insertedOriginal = true;
      continue;
    }
    if (editedCategory && /^- Category \(suggested\):/.test(ln)) {
      newLines.push(ln);
      newLines.push(`- Category (used): ${editedCategory}`);
      continue;
    }
    if (/^- Status: pending/.test(ln)) {
      newLines.push(`- Status: accepted (${ts})`);
      continue;
    }
    newLines.push(ln);
  }

  return source.slice(0, entry.rawBlockStart) +
    newLines.join("\n") +
    source.slice(entry.rawBlockEnd);
}

export function rejectSuggestion(
  source: string,
  entry: SuggestionEntry,
  now: Date = new Date(),
): string {
  const block = source.slice(entry.rawBlockStart, entry.rawBlockEnd);
  const ts = formatTs(now);
  const replaced = block.replace(/^- Status: pending/m, `- Status: rejected (${ts})`);
  return source.slice(0, entry.rawBlockStart) +
    replaced +
    source.slice(entry.rawBlockEnd);
}

export function phraseHash(phrase: string): string {
  return crypto.createHash("sha256").update(phrase.toLowerCase()).digest("hex");
}
