import type { LLMClient } from "../llm/types.js";
import type { TaskDAG } from "../orchestrator/types.js";
import type { GitHubIssue } from "./types.js";
import { ghJson } from "./cli.js";
import { GitHubIssueSchema } from "./types.js";
import { decomposeRequirement } from "../orchestrator/decompose.js";

const ISSUE_JSON_FIELDS =
  "number,title,body,state,url,labels,assignees,author,createdAt,updatedAt";

/**
 * Fetch a GitHub issue by number.
 */
export async function fetchIssue(
  issueNumber: number,
  options?: { repo?: string; cwd?: string },
): Promise<GitHubIssue> {
  const args = [
    "issue",
    "view",
    String(issueNumber),
    "--json",
    ISSUE_JSON_FIELDS,
  ];

  if (options?.repo) {
    args.push("--repo", options.repo);
  }

  const raw = await ghJson<unknown>(args, { cwd: options?.cwd });
  return GitHubIssueSchema.parse(raw);
}

/**
 * Format an issue into a requirement string for the decomposer.
 */
export function formatIssueAsRequirement(issue: GitHubIssue): string {
  const parts: string[] = [`# ${issue.title}`];

  if (issue.body) {
    parts.push("", issue.body);
  }

  const extras: string[] = [];

  if (issue.labels.length > 0) {
    extras.push(`Labels: ${issue.labels.map((l) => l.name).join(", ")}`);
  }

  if (issue.assignees.length > 0) {
    extras.push(
      `Assignees: ${issue.assignees.map((a) => a.login).join(", ")}`,
    );
  }

  if (extras.length > 0) {
    parts.push("", ...extras);
  }

  return parts.join("\n");
}

/**
 * Fetch a GitHub issue and decompose it into a TaskDAG.
 */
export async function planFromIssue(
  issueNumber: number,
  client: LLMClient,
  options?: { repo?: string; cwd?: string },
): Promise<{ issue: GitHubIssue; dag: TaskDAG }> {
  const issue = await fetchIssue(issueNumber, options);
  const requirement = formatIssueAsRequirement(issue);
  const dag = await decomposeRequirement(requirement, client);
  return { issue, dag };
}
