import type { TaskDAG, TaskResult } from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { SchedulerCallbacks, SchedulerResult } from "./scheduler.js";
import { runScheduler } from "./scheduler.js";

// ── Public interfaces ───────────────────────────────────────────────

export interface ReviewLoopOptions {
  /** Max review iterations before giving up (default: 3) */
  maxIterations?: number;
  /** Model router for the review agents */
  router: ModelRouter;
  /** Callbacks (passed through to scheduler) */
  callbacks?: SchedulerCallbacks;
}

export interface ReviewResult {
  /** Whether the review loop passed */
  passed: boolean;
  /** Number of iterations it took */
  iterations: number;
  /** Results from the final review */
  reviewResult?: SchedulerResult;
  /** Reason for failure if !passed */
  reason?: string;
}

// ── buildReviewDAG ──────────────────────────────────────────────────

/**
 * Build a review DAG that evaluates the output of a completed orchestration.
 * The review DAG has: code-review and test-review running in parallel.
 */
export function buildReviewDAG(
  originalDAG: TaskDAG,
  taskResults: Map<string, TaskResult>,
): TaskDAG {
  // Build a formatted context summary from all task results
  let context = "Review the following completed work:\n\n";

  for (const node of originalDAG.nodes) {
    const result = taskResults.get(node.id);
    context += `## Task: ${node.name}\n`;
    context += `Profile: ${node.profile}\n`;
    context += `Output: ${result?.output ?? "(no output)"}\n\n`;
  }

  return {
    id: `review-${originalDAG.id}`,
    name: `Review: ${originalDAG.name}`,
    goal: `Review the completed work from "${originalDAG.name}"`,
    nodes: [
      {
        id: "code-review",
        name: "Code Review",
        profile: "reviewer",
        tier: "standard",
        dependencies: [],
        context,
      },
      {
        id: "test-review",
        name: "Test Review",
        profile: "tester",
        tier: "standard",
        dependencies: [],
        context,
      },
    ],
    gates: [],
  };
}

// ── runReviewLoop ───────────────────────────────────────────────────

/**
 * Run a self-review loop on completed orchestration output.
 *
 * 1. Build a review DAG from the completed task results
 * 2. Run the review DAG via scheduler
 * 3. Check if review passed (all tasks succeed)
 * 4. If passed, return { passed: true }
 * 5. If failed, return { passed: false, reason }
 *
 * This is a single-pass review (not iterative fix-and-review).
 * The iterative pattern is: orchestrate → review → fix → review → ...
 * which is handled at a higher level.
 */
export async function runReviewLoop(
  originalDAG: TaskDAG,
  taskResults: Map<string, TaskResult>,
  options: ReviewLoopOptions,
): Promise<ReviewResult> {
  const reviewDAG = buildReviewDAG(originalDAG, taskResults);

  const schedulerResult = await runScheduler(
    reviewDAG,
    options.router,
    {},
    options.callbacks,
  );

  if (schedulerResult.status === "completed") {
    return {
      passed: true,
      iterations: 1,
      reviewResult: schedulerResult,
    };
  }

  return {
    passed: false,
    iterations: 1,
    reason: schedulerResult.error,
    reviewResult: schedulerResult,
  };
}
