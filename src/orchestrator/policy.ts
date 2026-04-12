import type { TaskDAG, TaskNode, ModelTier } from "./types.js";

// ── Types ──────────────────────────────────────────────────────────

export type PolicySeverity = "error" | "warning" | "info";

export interface PolicyViolation {
  rule: string;
  severity: PolicySeverity;
  message: string;
  nodeId?: string;
}

export interface PolicyResult {
  passed: boolean;
  violations: PolicyViolation[];
}

export interface PolicyRule {
  name: string;
  description: string;
  severity: PolicySeverity;
  check: (dag: TaskDAG) => PolicyViolation[];
}

// ── Built-in policy rules ──────────────────────────────────────────

const maxTaskCount: PolicyRule = {
  name: "max-task-count",
  description: "DAG has more than 20 tasks",
  severity: "warning",
  check: (dag) => {
    if (dag.nodes.length > 20) {
      return [
        {
          rule: "max-task-count",
          severity: "warning",
          message: `DAG has ${dag.nodes.length} tasks (limit: 20)`,
        },
      ];
    }
    return [];
  },
};

const requiresReview: PolicyRule = {
  name: "requires-review",
  description: 'No node with profile "reviewer" exists',
  severity: "warning",
  check: (dag) => {
    const hasReviewer = dag.nodes.some((n) => n.profile === "reviewer");
    if (!hasReviewer) {
      return [
        {
          rule: "requires-review",
          severity: "warning",
          message: "DAG has no reviewer node — consider adding a code review step",
        },
      ];
    }
    return [];
  },
};

const requiresTesting: PolicyRule = {
  name: "requires-testing",
  description: 'No node with profile "tester" exists',
  severity: "warning",
  check: (dag) => {
    const hasTester = dag.nodes.some((n) => n.profile === "tester");
    if (!hasTester) {
      return [
        {
          rule: "requires-testing",
          severity: "warning",
          message: "DAG has no tester node — consider adding a testing step",
        },
      ];
    }
    return [];
  },
};

const noOrphanNodes: PolicyRule = {
  name: "no-orphan-nodes",
  description: "Every node is either a root or has valid dependencies",
  severity: "error",
  check: (dag) => {
    const nodeIds = new Set(dag.nodes.map((n) => n.id));
    const violations: PolicyViolation[] = [];
    for (const node of dag.nodes) {
      for (const dep of node.dependencies) {
        if (!nodeIds.has(dep)) {
          violations.push({
            rule: "no-orphan-nodes",
            severity: "error",
            message: `Node "${node.id}" depends on "${dep}" which does not exist`,
            nodeId: node.id,
          });
        }
      }
    }
    return violations;
  },
};

const approvalBeforeDeploy: PolicyRule = {
  name: "approval-before-deploy",
  description:
    "If any node name contains 'deploy' or 'release', an approval gate should exist",
  severity: "warning",
  check: (dag) => {
    const deployNodes = dag.nodes.filter((n) => {
      const lower = n.name.toLowerCase();
      return lower.includes("deploy") || lower.includes("release");
    });
    if (deployNodes.length === 0) return [];

    const hasApprovalGate = dag.gates.some((g) => g.type === "approval");
    if (hasApprovalGate) return [];

    return deployNodes.map((n) => ({
      rule: "approval-before-deploy",
      severity: "warning" as const,
      message: `Node "${n.name}" looks like a deploy/release step but no approval gate exists`,
      nodeId: n.id,
    }));
  },
};

const noAdvancedWithoutJustification: PolicyRule = {
  name: "no-advanced-without-justification",
  description: 'Nodes with tier "advanced" flagged for cost awareness',
  severity: "info",
  check: (dag) =>
    dag.nodes
      .filter((n) => n.tier === "advanced")
      .map((n) => ({
        rule: "no-advanced-without-justification",
        severity: "info" as const,
        message: `Node "${n.id}" uses advanced tier — ensure this is justified for cost`,
        nodeId: n.id,
      })),
};

const maxParallelDepth: PolicyRule = {
  name: "max-parallel-depth",
  description: "DAG has more than 5 levels of depth",
  severity: "warning",
  check: (dag) => {
    // Compute max depth via topological traversal
    const nodeIds = new Set(dag.nodes.map((n) => n.id));
    const depthMap = new Map<string, number>();

    // Build adjacency: for each node, depth = max(depth of deps) + 1
    // Handle missing deps gracefully (they are caught by no-orphan-nodes)
    function getDepth(node: TaskNode, visited: Set<string>): number {
      if (depthMap.has(node.id)) return depthMap.get(node.id)!;
      if (visited.has(node.id)) return 0; // cycle guard
      visited.add(node.id);

      let maxDep = 0;
      for (const depId of node.dependencies) {
        const depNode = dag.nodes.find((n) => n.id === depId);
        if (depNode) {
          maxDep = Math.max(maxDep, getDepth(depNode, visited) + 1);
        }
      }
      depthMap.set(node.id, maxDep);
      return maxDep;
    }

    for (const node of dag.nodes) {
      getDepth(node, new Set());
    }

    const maxDepth = Math.max(0, ...depthMap.values());
    if (maxDepth > 5) {
      return [
        {
          rule: "max-parallel-depth",
          severity: "warning",
          message: `DAG depth is ${maxDepth} (limit: 5)`,
        },
      ];
    }
    return [];
  },
};

// ── Public API ─────────────────────────────────────────────────────

/**
 * Create built-in policy rules.
 */
export function getDefaultPolicies(): PolicyRule[] {
  return [
    maxTaskCount,
    requiresReview,
    requiresTesting,
    noOrphanNodes,
    approvalBeforeDeploy,
    noAdvancedWithoutJustification,
    maxParallelDepth,
  ];
}

/**
 * Evaluate a DAG against a set of policy rules.
 */
export function evaluatePolicy(
  dag: TaskDAG,
  rules?: PolicyRule[],
): PolicyResult {
  const effectiveRules = rules ?? getDefaultPolicies();
  const violations: PolicyViolation[] = [];

  for (const rule of effectiveRules) {
    violations.push(...rule.check(dag));
  }

  const hasErrors = violations.some((v) => v.severity === "error");

  return {
    passed: !hasErrors,
    violations,
  };
}

/**
 * Format policy result for display.
 */
export function formatPolicyResult(result: PolicyResult): string {
  const lines: string[] = [];
  const status = result.passed ? "PASS" : "FAIL";
  lines.push(`Policy check: ${status}`);

  if (result.violations.length === 0) {
    lines.push("  No violations found.");
    return lines.join("\n");
  }

  for (const v of result.violations) {
    const nodeLabel = v.nodeId ? ` [${v.nodeId}]` : "";
    lines.push(`  [${v.severity}] ${v.rule}${nodeLabel}: ${v.message}`);
  }

  return lines.join("\n");
}
