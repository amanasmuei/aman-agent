import type { TaskDAG, TaskNode, PhaseGate } from "../types.js";
import { validateDAG } from "../dag.js";

// ── Template Options ───────────────────────────────────────────────

export interface TemplateOptions {
  /** Project/feature name */
  name: string;
  /** Goal description */
  goal: string;
  /** Include approval gate before final phase */
  requireApproval?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────

function node(
  id: string,
  profile: string,
  tier: TaskNode["tier"],
  deps: string[] = [],
): TaskNode {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    profile,
    tier,
    dependencies: deps,
  };
}

function approvalGate(
  id: string,
  afterNodes: string[],
  beforeNodes: string[],
): PhaseGate {
  return {
    id,
    name: `Approval: ${id}`,
    type: "approval",
    afterNodes,
    beforeNodes,
  };
}

// ── Templates ──────────────────────────────────────────────────────

/**
 * Full feature development: architect → parallel coders → review → test → merge
 *
 * design (architect, advanced) → implement (coder) → review + test (parallel) → finalize
 * Optional approval gate between [review, test] and [finalize].
 */
export function fullFeatureTemplate(options: TemplateOptions): TaskDAG {
  const gates: PhaseGate[] = [];

  if (options.requireApproval) {
    gates.push(approvalGate("approval", ["review", "test"], ["finalize"]));
  }

  const dag: TaskDAG = {
    id: `full-feature-${options.name}`,
    name: `Full Feature: ${options.name}`,
    goal: options.goal,
    nodes: [
      node("design", "architect", "advanced"),
      node("implement", "coder", "standard", ["design"]),
      node("review", "reviewer", "standard", ["implement"]),
      node("test", "tester", "standard", ["implement"]),
      node("finalize", "coder", "standard", ["review", "test"]),
    ],
    gates,
  };

  validateDAG(dag);
  return dag;
}

/**
 * Bug fix: reproduce → fix → test → review
 *
 * With approval: adds a verify step gated behind review.
 */
export function bugFixTemplate(options: TemplateOptions): TaskDAG {
  const nodes: TaskNode[] = [
    node("reproduce", "tester", "standard"),
    node("fix", "coder", "standard", ["reproduce"]),
    node("test", "tester", "standard", ["fix"]),
    node("review", "reviewer", "standard", ["test"]),
  ];

  const gates: PhaseGate[] = [];

  if (options.requireApproval) {
    nodes.push(node("verify", "tester", "standard", ["review"]));
    gates.push(approvalGate("approval", ["review"], ["verify"]));
  }

  const dag: TaskDAG = {
    id: `bug-fix-${options.name}`,
    name: `Bug Fix: ${options.name}`,
    goal: options.goal,
    nodes,
    gates,
  };

  validateDAG(dag);
  return dag;
}

/**
 * Security audit: scan → triage → fix → rescan → review
 *
 * With approval: gates the fix step behind triage approval.
 */
export function securityAuditTemplate(options: TemplateOptions): TaskDAG {
  const gates: PhaseGate[] = [];

  if (options.requireApproval) {
    gates.push(approvalGate("approval", ["triage"], ["fix"]));
  }

  const dag: TaskDAG = {
    id: `security-audit-${options.name}`,
    name: `Security Audit: ${options.name}`,
    goal: options.goal,
    nodes: [
      node("scan", "security", "standard"),
      node("triage", "security", "standard", ["scan"]),
      node("fix", "coder", "standard", ["triage"]),
      node("rescan", "security", "standard", ["fix"]),
      node("review", "reviewer", "standard", ["rescan"]),
    ],
    gates,
  };

  validateDAG(dag);
  return dag;
}

// ── Registry ───────────────────────────────────────────────────────

const TEMPLATES: Record<string, (options: TemplateOptions) => TaskDAG> = {
  "full-feature": fullFeatureTemplate,
  "bug-fix": bugFixTemplate,
  "security-audit": securityAuditTemplate,
};

/**
 * Get a template by name.
 */
export function getTemplate(
  name: string,
): ((options: TemplateOptions) => TaskDAG) | undefined {
  return TEMPLATES[name];
}

/**
 * List available template names.
 */
export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}
