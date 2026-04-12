import { ghJson } from "./cli.js";
import { WorkflowRunSchema, CheckStatusSchema } from "./types.js";
import type { WorkflowRun, CheckStatus } from "./types.js";

const RUN_JSON_FIELDS =
  "databaseId,name,workflowName,status,conclusion,url,headBranch,event,createdAt,updatedAt";

/**
 * Get the latest workflow run for a branch.
 */
export async function getLatestRun(
  branch: string,
  options?: { workflow?: string; repo?: string; cwd?: string },
): Promise<WorkflowRun | null> {
  const args = [
    "run",
    "list",
    "--branch",
    branch,
    "--limit",
    "1",
    "--json",
    RUN_JSON_FIELDS,
  ];

  if (options?.workflow) {
    args.push("--workflow", options.workflow);
  }
  if (options?.repo) {
    args.push("--repo", options.repo);
  }

  const runs = await ghJson<unknown[]>(args, { cwd: options?.cwd });

  if (!runs.length) return null;

  return WorkflowRunSchema.parse(runs[0]);
}

/**
 * Get check status for a specific commit or PR.
 */
export async function getCheckStatus(
  ref: string,
  options?: { repo?: string; cwd?: string },
): Promise<CheckStatus> {
  // If ref looks like a PR number, use `gh pr checks`
  const isPRNumber = /^\d+$/.test(ref);

  if (isPRNumber) {
    const args = ["pr", "checks", ref, "--json", "name,status,conclusion"];
    if (options?.repo) args.push("--repo", options.repo);

    const checks = await ghJson<
      Array<{ name: string; status: string; conclusion: string | null }>
    >(args, { cwd: options?.cwd });

    const details = checks.map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
    }));

    const passed = details.every(
      (d) => d.status === "completed" && d.conclusion === "success",
    );
    const pending = details.some((d) => d.status !== "completed");
    const failing = details.some(
      (d) =>
        d.status === "completed" &&
        d.conclusion !== "success" &&
        d.conclusion !== "skipped" &&
        d.conclusion !== "neutral",
    );

    return CheckStatusSchema.parse({
      passed: passed && details.length > 0,
      pending,
      failing,
      total: details.length,
      details,
    });
  }

  // For commit SHAs, fall back to run list
  const run = await getLatestRun(ref, options);

  if (!run) {
    return CheckStatusSchema.parse({
      passed: false,
      pending: false,
      failing: false,
      total: 0,
      details: [],
    });
  }

  return CheckStatusSchema.parse({
    passed: run.status === "completed" && run.conclusion === "success",
    pending: run.status !== "completed",
    failing:
      run.status === "completed" &&
      run.conclusion !== "success" &&
      run.conclusion !== "skipped" &&
      run.conclusion !== "neutral",
    total: 1,
    details: [
      { name: run.name, status: run.status, conclusion: run.conclusion },
    ],
  });
}

/**
 * Wait for CI to complete on a branch. Polls at interval.
 */
export async function waitForCI(
  branch: string,
  options?: {
    workflow?: string;
    repo?: string;
    cwd?: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<{ passed: boolean; run: WorkflowRun | null }> {
  const pollInterval = options?.pollIntervalMs ?? 10_000;
  const timeout = options?.timeoutMs ?? 600_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const run = await getLatestRun(branch, options);

    if (run && run.status === "completed") {
      return { passed: run.conclusion === "success", run };
    }

    // Check if we'd exceed deadline after sleeping
    if (Date.now() + pollInterval >= deadline) break;

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return { passed: false, run: null };
}

/**
 * Check if CI is passing for a branch (non-blocking snapshot).
 */
export async function isCIPassing(
  branch: string,
  options?: { workflow?: string; repo?: string; cwd?: string },
): Promise<boolean> {
  const run = await getLatestRun(branch, options);
  return run !== null && run.status === "completed" && run.conclusion === "success";
}
