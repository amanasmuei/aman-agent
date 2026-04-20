import pc from "picocolors";
import { delegateTask, delegatePipeline } from "../delegate.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handleDelegateCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    return { handled: true, output: `Delegate commands:
  /delegate <profile> <task>        Delegate a task to a local profile
  /delegate @<name> <task>          Delegate to another running aman-agent (A2A)
  /delegate pipeline <p1> <p2> ...  Run a sequential pipeline
  /delegate help                    Show help

Examples:
  /delegate writer Write a blog post about AI companions
  /delegate coder Review this code for security issues
  /delegate @reviewer Review PR #42 for security issues
  /delegate pipeline writer,researcher Write and fact-check an article about quantum computing` };
  }

  if (action === "help") {
    return { handled: true, output: `Delegate a task to a sub-agent with a specific profile.

The sub-agent runs with its own identity, rules, and skills but shares
your memory and tools. Results come back to you.

Usage:
  /delegate <profile> <task>             Local sub-agent with named profile
  /delegate @<name> <task>               Remote aman-agent (A2A via MCP)
  /delegate pipeline <profile1>,<profile2> <task>

Use /agents list to see which remote agents are running.

The pipeline mode passes each agent's output to the next:
  writer drafts \u2192 researcher reviews \u2192 writer polishes` };
  }

  if (!ctx.llmClient || !ctx.mcpManager) {
    return { handled: true, output: pc.red("Delegation requires LLM client and MCP. Not available.") };
  }

  if (action === "pipeline") {
    const profileList = args[0];
    const task = args.slice(1).join(" ");
    if (!profileList || !task) {
      return { handled: true, output: pc.yellow("Usage: /delegate pipeline <profile1>,<profile2> <task>") };
    }

    const profiles = profileList.split(",").map((p) => p.trim());
    const steps = profiles.map((profile, i) => {
      if (i === 0) {
        return { profile, taskTemplate: task };
      }
      return { profile, taskTemplate: `Review and improve the following:\n\n{{input}}` };
    });

    process.stdout.write(pc.dim(`\n  Pipeline: ${profiles.join(" \u2192 ")}\n`));

    const results = await delegatePipeline(steps, task, ctx.llmClient, ctx.mcpManager, { tools: ctx.tools });

    const output: string[] = [];
    for (const r of results) {
      if (r.success) {
        output.push(`\n${pc.bold(`[${r.profile}]`)} ${pc.green("\u2713")} (${r.turns} tool turns)`);
        output.push(r.response.slice(0, 2000));
        if (r.toolsUsed.length > 0) output.push(pc.dim(`  Tools: ${r.toolsUsed.join(", ")}`));
      } else {
        output.push(`\n${pc.bold(`[${r.profile}]`)} ${pc.red("\u2717")} ${r.error}`);
      }
    }

    return { handled: true, output: output.join("\n") };
  }

  const profile = action;
  const task = args.join(" ");
  if (!task) {
    return { handled: true, output: pc.yellow(`Usage: /delegate ${profile} <task description>`) };
  }

  process.stdout.write(pc.dim(`\n  [delegating to ${profile}...]\n\n`));

  const result = await delegateTask(task, profile, ctx.llmClient, ctx.mcpManager, { tools: ctx.tools });

  if (!result.success) {
    return { handled: true, output: pc.red(`Delegation failed: ${result.error}`) };
  }

  const meta: string[] = [];
  if (result.toolsUsed.length > 0) meta.push(`Tools: ${result.toolsUsed.join(", ")}`);
  if (result.turns > 0) meta.push(`${result.turns} tool turns`);

  return {
    handled: true,
    output: `\n${pc.bold(`[${profile}]`)} ${pc.green("\u2713")}${meta.length > 0 ? " " + pc.dim(`(${meta.join(", ")})`) : ""}\n\n${result.response}`,
  };
}
