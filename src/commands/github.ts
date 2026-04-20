import pc from "picocolors";
import {
  ghAvailable,
  ghCurrentRepo,
  listPRs,
  fetchIssue,
  formatIssueAsRequirement,
  isCIPassing,
} from "../github/index.js";
import { smartOrchestrate, createModelRouter } from "../orchestrator/index.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handleGitHubCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    const available = await ghAvailable();
    if (!available) {
      return { handled: true, output: pc.red("GitHub CLI (gh) is not available or not authenticated. Run: gh auth login") };
    }
    const repo = await ghCurrentRepo();
    if (!repo) {
      return { handled: true, output: pc.yellow("Not inside a GitHub repository.") };
    }
    return { handled: true, output: `GitHub repo: ${pc.bold(`${repo.owner}/${repo.name}`)}` };
  }

  switch (action) {
    case "issues": {
      const { gh: ghExec } = await import("../github/index.js");
      const repoArgs = args.length > 0 ? ["--repo", args[0]] : [];
      const result = await ghExec(["issue", "list", "--limit", "10", ...repoArgs]);
      if (!result.success) {
        return { handled: true, output: pc.red(`Failed to list issues: ${result.stderr}`) };
      }
      return { handled: true, output: result.stdout.trim() || pc.dim("No open issues.") };
    }

    case "prs": {
      const repoArgs: { repo?: string } = args.length > 0 ? { repo: args[0] } : {};
      try {
        const prs = await listPRs({ state: "open", limit: 10, ...repoArgs });
        if (prs.length === 0) {
          return { handled: true, output: pc.dim("No open PRs.") };
        }
        const lines = prs.map(
          (pr) => `#${pr.number} ${pr.title} (${pr.headRefName} \u2192 ${pr.baseRefName})${pr.isDraft ? " [draft]" : ""}`,
        );
        return { handled: true, output: lines.join("\n") };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, output: pc.red(`Failed to list PRs: ${msg}`) };
      }
    }

    case "plan": {
      const issueNum = parseInt(args[0], 10);
      if (!issueNum || isNaN(issueNum)) {
        return { handled: true, output: pc.red("Usage: /github plan <issue-number>") };
      }
      if (!ctx.llmClient) {
        return { handled: true, output: pc.red("Planning requires an LLM client. Not available.") };
      }
      try {
        const issue = await fetchIssue(issueNum);
        const requirement = formatIssueAsRequirement(issue);
        const router = createModelRouter({ standard: ctx.llmClient });
        const result = await smartOrchestrate({
          requirement,
          client: ctx.llmClient,
          router,
          projectPath: process.cwd(),
          enablePolicyCheck: true,
          enableSelfReview: false,
          enableCostTracking: true,
        });
        return {
          handled: true,
          output: `${pc.bold(`Plan for #${issue.number}: ${issue.title}`)}\n\n${result.summary}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, output: pc.red(`Failed to plan issue #${issueNum}: ${msg}`) };
      }
    }

    case "ci": {
      const branch = args[0];
      if (!branch) {
        return { handled: true, output: pc.red("Usage: /github ci <branch>") };
      }
      try {
        const passing = await isCIPassing(branch);
        return {
          handled: true,
          output: passing
            ? pc.green(`CI is passing on ${branch}`)
            : pc.yellow(`CI is NOT passing on ${branch}`),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, output: pc.red(`Failed to check CI: ${msg}`) };
      }
    }

    default:
      return {
        handled: true,
        output: [
          `Usage: /github [subcommand]`,
          ``,
          `Subcommands:`,
          `  (none)           Show current repo info`,
          `  issues [repo]    List open issues`,
          `  prs [repo]       List open PRs`,
          `  plan <number>    Plan from a GitHub issue`,
          `  ci <branch>      Check CI status for a branch`,
        ].join("\n"),
      };
  }
}
