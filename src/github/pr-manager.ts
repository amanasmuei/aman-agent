import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gh, ghJson } from "./cli.js";
import { GitHubPRSchema } from "./types.js";
import type { GitHubPR } from "./types.js";

const execFileAsync = promisify(execFile);

/** JSON fields requested from gh for PR objects. */
const PR_JSON_FIELDS =
  "number,title,body,state,url,headRefName,baseRefName,isDraft,mergeable,labels,author,createdAt,updatedAt";

// ---------- types ----------

export interface CreatePROptions {
  title: string;
  body: string;
  head: string;
  base?: string;
  draft?: boolean;
  labels?: string[];
  repo?: string;
  cwd?: string;
}

// ---------- createPR ----------

/**
 * Create a pull request via gh CLI.
 */
export async function createPR(options: CreatePROptions): Promise<GitHubPR> {
  const args: string[] = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
    "--head",
    options.head,
  ];

  if (options.base) {
    args.push("--base", options.base);
  }
  if (options.draft) {
    args.push("--draft");
  }
  if (options.labels) {
    for (const label of options.labels) {
      args.push("--label", label);
    }
  }
  if (options.repo) {
    args.push("--repo", options.repo);
  }

  const ghOpts = options.cwd ? { cwd: options.cwd } : undefined;

  // Create the PR — gh prints the URL on success
  const result = await gh(args, ghOpts);
  if (!result.success) {
    const { GhError } = await import("./cli.js");
    throw new GhError(
      `Failed to create PR: ${result.stderr}`,
      result.exitCode,
      result.stderr,
    );
  }

  // Extract PR number from the URL (last path segment)
  const url = result.stdout.trim();
  const prNumber = parseInt(url.split("/").pop()!, 10);

  // Fetch full PR data
  return getPR(prNumber, { repo: options.repo, cwd: options.cwd });
}

// ---------- listPRs ----------

/**
 * List open PRs, optionally filtered.
 */
export async function listPRs(options?: {
  state?: "open" | "closed" | "merged" | "all";
  head?: string;
  limit?: number;
  repo?: string;
  cwd?: string;
}): Promise<GitHubPR[]> {
  const args: string[] = ["pr", "list", "--json", PR_JSON_FIELDS];

  if (options?.state) {
    args.push("--state", options.state);
  }
  if (options?.head) {
    args.push("--head", options.head);
  }
  if (options?.limit != null) {
    args.push("--limit", String(options.limit));
  }
  if (options?.repo) {
    args.push("--repo", options.repo);
  }

  const ghOpts = options?.cwd ? { cwd: options.cwd } : undefined;
  const raw = await ghJson<unknown[]>(args, ghOpts);

  return raw.map((item) => GitHubPRSchema.parse(item));
}

// ---------- getPR ----------

/**
 * Get a specific PR by number.
 */
export async function getPR(
  prNumber: number,
  options?: { repo?: string; cwd?: string },
): Promise<GitHubPR> {
  const args: string[] = [
    "pr",
    "view",
    String(prNumber),
    "--json",
    PR_JSON_FIELDS,
  ];

  if (options?.repo) {
    args.push("--repo", options.repo);
  }

  const ghOpts = options?.cwd ? { cwd: options.cwd } : undefined;
  const raw = await ghJson<unknown>(args, ghOpts);

  return GitHubPRSchema.parse(raw);
}

// ---------- commentOnPR ----------

/**
 * Post a review comment on a PR.
 */
export async function commentOnPR(
  prNumber: number,
  body: string,
  options?: { repo?: string; cwd?: string },
): Promise<void> {
  const args: string[] = ["pr", "comment", String(prNumber), "--body", body];

  if (options?.repo) {
    args.push("--repo", options.repo);
  }

  const ghOpts = options?.cwd ? { cwd: options.cwd } : undefined;
  const result = await gh(args, ghOpts);

  if (!result.success) {
    const { GhError } = await import("./cli.js");
    throw new GhError(
      `Failed to comment on PR #${prNumber}: ${result.stderr}`,
      result.exitCode,
      result.stderr,
    );
  }
}

// ---------- createBranch ----------

/**
 * Create a git branch (via git, not gh).
 */
export async function createBranch(
  branchName: string,
  options?: { baseBranch?: string; cwd?: string },
): Promise<void> {
  const args = ["checkout", "-b", branchName];

  if (options?.baseBranch) {
    args.push(options.baseBranch);
  }

  const execOpts: Record<string, unknown> = {};
  if (options?.cwd) {
    execOpts.cwd = options.cwd;
  }

  await execFileAsync("git", args, execOpts);
}
