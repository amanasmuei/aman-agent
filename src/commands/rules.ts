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
      ].join("\n"),
    };
  }
  return {
    handled: true,
    output: pc.yellow(`Unknown action: /rules ${action}. Try /rules --help`),
  };
}
