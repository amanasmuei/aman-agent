import pc from "picocolors";
import { smartOrchestrate, createModelRouter } from "../orchestrator/index.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handleOrchestrateCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    return {
      handled: true,
      output: [
        "Usage: /orchestrate <requirement>",
        "",
        "Decomposes a requirement into a task DAG and executes it with parallel agents.",
        "Auto-detects project type, selects template, runs policy check, and tracks cost.",
        "",
        "Options (pass as first arg):",
        "  --template <name>   Force a template (full-feature, bug-fix, security-audit)",
        "  --no-review         Skip self-review loop",
        "  --no-policy         Skip policy check",
        "",
        "Alias: /orch",
      ].join("\n"),
    };
  }

  if (!ctx.llmClient) {
    return { handled: true, output: pc.red("Orchestration requires an LLM client. Not available.") };
  }

  let templateName: string | undefined;
  let enableSelfReview = true;
  let enablePolicyCheck = true;
  const filtered: string[] = [];

  const allArgs = [action, ...args];
  for (let i = 0; i < allArgs.length; i++) {
    if (allArgs[i] === "--template" && allArgs[i + 1]) {
      templateName = allArgs[++i];
    } else if (allArgs[i] === "--no-review") {
      enableSelfReview = false;
    } else if (allArgs[i] === "--no-policy") {
      enablePolicyCheck = false;
    } else {
      filtered.push(allArgs[i]);
    }
  }

  const requirement = filtered.join(" ");
  if (!requirement.trim()) {
    return { handled: true, output: pc.red("Please provide a requirement to orchestrate.") };
  }

  try {
    const router = createModelRouter({ standard: ctx.llmClient });
    const result = await smartOrchestrate({
      requirement,
      client: ctx.llmClient,
      router,
      projectPath: process.cwd(),
      templateName,
      enablePolicyCheck,
      enableSelfReview,
      enableCostTracking: true,
    });

    return { handled: true, output: result.summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { handled: true, output: pc.red(`Orchestration failed: ${msg}`) };
  }
}
