import type { LLMClient } from "../llm/types.js";
import type { TaskDAG } from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { FullOrchestrationResult } from "./runner.js";
import type { SchedulerCallbacks } from "./scheduler.js";

import { decomposeRequirement } from "./decompose.js";
import { getTemplate } from "./templates/index.js";
import { runOrchestrationFull } from "./runner.js";
import { classifyProject } from "../project/detector.js";
import { scanStack } from "../dev/stack-detector.js";
import {
  ensureAllProfilesInstalled,
  getProfilesDir,
} from "../profiles/auto-install.js";

// ── DAG Display (inlined to avoid circular import with index.ts) ────

function formatDAGForDisplay(dag: TaskDAG): string {
  const lines: string[] = [];
  lines.push(`## ${dag.name}`);
  lines.push(`**Goal:** ${dag.goal}`);
  lines.push(`**Tasks:** ${dag.nodes.length} | **Gates:** ${dag.gates.length}`);
  lines.push("");
  for (const node of dag.nodes) {
    const depLabel =
      node.dependencies.length === 0
        ? "(root)"
        : `(after: ${node.dependencies.join(", ")})`;
    lines.push(`- **${node.name}** \u2192 ${node.profile} [${node.tier}] ${depLabel}`);
  }
  for (const gate of dag.gates) {
    lines.push(`- \uD83D\uDD12 **${gate.name}** [${gate.type}]`);
  }
  return lines.join("\n");
}

// ── Options ─────────────────────────────────────────────────────────

export interface SmartOrchestrationOptions {
  /** The requirement to orchestrate */
  requirement: string;
  /** LLM client for decomposition */
  client: LLMClient;
  /** Model router for task execution */
  router: ModelRouter;
  /** Optional: project path for auto-classification */
  projectPath?: string;
  /** Optional: force a specific template name */
  templateName?: string;
  /** Enable enterprise features */
  enablePolicyCheck?: boolean;
  enableSelfReview?: boolean;
  enableCostTracking?: boolean;
  budgetLimit?: number | null;
  /** Callbacks */
  callbacks?: SchedulerCallbacks;
}

// ── Result ──────────────────────────────────────────────────────────

export interface SmartOrchestrationResult {
  /** The DAG that was generated or selected */
  dag: TaskDAG;
  /** Project type detected (if projectPath provided) */
  projectType?: string;
  /** Template used (if any) */
  templateUsed?: string;
  /** Full orchestration result */
  orchestration: FullOrchestrationResult;
  /** Human-readable summary */
  summary: string;
}

// ── Smart Orchestration Pipeline ────────────────────────────────────

/**
 * Smart orchestration pipeline:
 * 1. Ensure orchestrator profiles are installed
 * 2. If projectPath → classify project, get recommended template
 * 3. If templateName → use that template to build DAG
 * 4. Otherwise → decompose requirement via LLM
 * 5. Run full orchestration (policy + scheduler + circuit breakers + cost + review)
 * 6. Return consolidated result with summary
 */
export async function smartOrchestrate(
  options: SmartOrchestrationOptions,
): Promise<SmartOrchestrationResult> {
  // 1. Auto-install profiles
  ensureAllProfilesInstalled(getProfilesDir());

  // 2. Detect project type if path given and no explicit template
  let projectType: string | undefined;
  let templateName = options.templateName;

  if (options.projectPath && !templateName) {
    const stack = scanStack(options.projectPath);
    const classification = classifyProject(stack);
    projectType = classification.type;
    templateName = classification.suggestedTemplate;
  }

  // 3. Build DAG — template if available, otherwise LLM decomposition
  let dag: TaskDAG;
  if (templateName) {
    const templateFn = getTemplate(templateName);
    if (templateFn) {
      dag = templateFn({ name: "Orchestration", goal: options.requirement });
    } else {
      // Template not found — fall back to LLM
      dag = await decomposeRequirement(options.requirement, options.client);
      templateName = undefined;
    }
  } else {
    dag = await decomposeRequirement(options.requirement, options.client);
  }

  // 4. Run full orchestration
  const orchestration = await runOrchestrationFull(dag, {
    router: options.router,
    enablePolicyCheck: options.enablePolicyCheck,
    enableSelfReview: options.enableSelfReview,
    enableCostTracking: options.enableCostTracking,
    budgetLimit: options.budgetLimit,
    callbacks: options.callbacks,
  });

  // 5. Build summary
  const summary = formatSmartResult({
    dag,
    projectType,
    templateUsed: templateName,
    orchestration,
    summary: "",
  });

  return { dag, projectType, templateUsed: templateName, orchestration, summary };
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format a SmartOrchestrationResult for CLI display.
 */
export function formatSmartResult(result: SmartOrchestrationResult): string {
  const lines: string[] = [];

  if (result.projectType) {
    lines.push(`Project type: ${result.projectType}`);
  }
  if (result.templateUsed) {
    lines.push(`Template: ${result.templateUsed}`);
  }

  lines.push("");
  lines.push(formatDAGForDisplay(result.dag));
  lines.push("");

  const orch = result.orchestration;
  lines.push(
    `Status: ${orch.success ? "completed" : "failed"} (${orch.durationMs}ms)`,
  );

  if (orch.policy && !orch.policy.passed) {
    const errorCount = orch.policy.violations.filter(
      (v) => v.severity === "error",
    ).length;
    lines.push(
      `Policy: FAILED — ${errorCount} error${errorCount !== 1 ? "s" : ""}`,
    );
  }
  if (orch.review) {
    lines.push(`Review: ${orch.review.passed ? "passed" : "failed"}`);
  }
  if (orch.costSummary) {
    lines.push(`Cost: ${orch.costSummary}`);
  }

  return lines.join("\n");
}
