import { describe, it, expect } from "vitest";
import type { TaskDAG } from "../../src/orchestrator/types.js";
import {
  evaluatePolicy,
  getDefaultPolicies,
  formatPolicyResult,
  type PolicyRule,
  type PolicyViolation,
} from "../../src/orchestrator/policy.js";

// ── Helpers ────────────────────────────────────────────────────────

function mkNode(
  id: string,
  deps: string[] = [],
  overrides: { profile?: string; tier?: "fast" | "standard" | "advanced"; name?: string } = {},
) {
  return {
    id,
    name: overrides.name ?? `Task ${id}`,
    profile: overrides.profile ?? "developer",
    tier: (overrides.tier ?? "standard") as const,
    dependencies: deps,
  };
}

function mkDAG(
  nodes: ReturnType<typeof mkNode>[],
  gates: TaskDAG["gates"] = [],
): TaskDAG {
  return {
    id: "test-dag",
    name: "Test DAG",
    goal: "Testing",
    nodes,
    gates,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("policy engine", () => {
  // 1. evaluatePolicy passes on valid DAG with reviewer and tester
  it("passes on valid DAG with reviewer and tester", () => {
    const dag = mkDAG([
      mkNode("a", [], { profile: "developer" }),
      mkNode("b", ["a"], { profile: "reviewer" }),
      mkNode("c", ["b"], { profile: "tester" }),
    ]);
    const result = evaluatePolicy(dag);
    expect(result.passed).toBe(true);
    expect(result.violations.filter((v) => v.severity === "error")).toHaveLength(0);
  });

  // 2. max-task-count triggers on DAG with >20 tasks
  it("max-task-count triggers on DAG with >20 tasks", () => {
    const nodes = Array.from({ length: 21 }, (_, i) => mkNode(`t${i}`));
    // add reviewer + tester to avoid those warnings
    nodes.push(mkNode("rev", [], { profile: "reviewer" }));
    nodes.push(mkNode("tst", [], { profile: "tester" }));
    const dag = mkDAG(nodes);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "max-task-count");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  // 3. requires-review triggers when no reviewer profile
  it("requires-review triggers when no reviewer profile", () => {
    const dag = mkDAG([
      mkNode("a"),
      mkNode("b", ["a"], { profile: "tester" }),
    ]);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "requires-review");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  // 4. requires-testing triggers when no tester profile
  it("requires-testing triggers when no tester profile", () => {
    const dag = mkDAG([
      mkNode("a"),
      mkNode("b", ["a"], { profile: "reviewer" }),
    ]);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "requires-testing");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  // 5. no-orphan-nodes passes on valid DAG
  it("no-orphan-nodes passes on valid DAG", () => {
    const dag = mkDAG([
      mkNode("a"),
      mkNode("b", ["a"]),
      mkNode("c", ["b"]),
    ]);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "no-orphan-nodes");
    expect(v).toBeUndefined();
  });

  // 6. approval-before-deploy triggers on deploy node without gate
  it("approval-before-deploy triggers on deploy node without gate", () => {
    const dag = mkDAG([
      mkNode("a"),
      mkNode("deploy", ["a"], { name: "deploy-to-prod", profile: "reviewer" }),
      mkNode("tst", [], { profile: "tester" }),
    ]);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "approval-before-deploy");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  // 7. approval-before-deploy passes when gate exists
  it("approval-before-deploy passes when gate exists", () => {
    const dag = mkDAG(
      [
        mkNode("a"),
        mkNode("deploy", ["a"], { name: "deploy-to-prod", profile: "reviewer" }),
        mkNode("tst", [], { profile: "tester" }),
      ],
      [
        {
          id: "gate-1",
          name: "Approval Gate",
          type: "approval",
          afterNodes: ["a"],
          beforeNodes: ["deploy"],
        },
      ],
    );
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "approval-before-deploy");
    expect(v).toBeUndefined();
  });

  // 8. no-advanced-without-justification flags advanced tier nodes
  it("no-advanced-without-justification flags advanced tier nodes", () => {
    const dag = mkDAG([
      mkNode("a", [], { tier: "advanced", profile: "reviewer" }),
      mkNode("b", ["a"], { profile: "tester" }),
    ]);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "no-advanced-without-justification");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("info");
    expect(v!.nodeId).toBe("a");
  });

  // 9. evaluatePolicy returns passed=true when no errors (warnings ok)
  it("returns passed=true when only warnings exist (no errors)", () => {
    // No reviewer → warning but no error
    const dag = mkDAG([
      mkNode("a"),
      mkNode("b", ["a"], { profile: "tester" }),
    ]);
    const result = evaluatePolicy(dag);
    expect(result.violations.some((v) => v.severity === "warning")).toBe(true);
    expect(result.passed).toBe(true);
  });

  // 10. evaluatePolicy returns passed=false when errors exist
  it("returns passed=false when errors exist", () => {
    // Orphan node — has dependency on nonexistent node → error
    const dag = mkDAG([
      mkNode("a"),
      mkNode("b", ["nonexistent"]),
    ]);
    const result = evaluatePolicy(dag);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.severity === "error")).toBe(true);
  });

  // 11. formatPolicyResult formats violations
  it("formatPolicyResult formats violations", () => {
    const result = {
      passed: false,
      violations: [
        { rule: "test-rule", severity: "error" as const, message: "Something broke" },
        { rule: "test-warn", severity: "warning" as const, message: "Watch out" },
      ],
    };
    const output = formatPolicyResult(result);
    expect(output).toContain("FAIL");
    expect(output).toContain("error");
    expect(output).toContain("Something broke");
    expect(output).toContain("warning");
    expect(output).toContain("Watch out");
  });

  it("formatPolicyResult shows PASS when passed", () => {
    const result = { passed: true, violations: [] };
    const output = formatPolicyResult(result);
    expect(output).toContain("PASS");
  });

  // 12. custom rules can be added
  it("custom rules can be added", () => {
    const customRule: PolicyRule = {
      name: "no-fast-tier",
      description: "Fast tier is not allowed",
      severity: "error",
      check: (dag) =>
        dag.nodes
          .filter((n) => n.tier === "fast")
          .map((n) => ({
            rule: "no-fast-tier",
            severity: "error" as const,
            message: `Node "${n.id}" uses fast tier`,
            nodeId: n.id,
          })),
    };
    const dag = mkDAG([
      mkNode("a", [], { tier: "fast", profile: "reviewer" }),
      mkNode("b", ["a"], { profile: "tester" }),
    ]);
    const rules = [...getDefaultPolicies(), customRule];
    const result = evaluatePolicy(dag, rules);
    const v = result.violations.find((v) => v.rule === "no-fast-tier");
    expect(v).toBeDefined();
    expect(result.passed).toBe(false);
  });

  // 13. max-parallel-depth triggers on deep DAG
  it("max-parallel-depth triggers on DAG with >5 levels", () => {
    // Create a linear chain of 7 nodes (depth = 7 > 5)
    const nodes = [mkNode("d0", [], { profile: "reviewer" })];
    for (let i = 1; i < 7; i++) {
      nodes.push(mkNode(`d${i}`, [`d${i - 1}`]));
    }
    nodes.push(mkNode("tst", [], { profile: "tester" }));
    const dag = mkDAG(nodes);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "max-parallel-depth");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  // 14. no-orphan-nodes catches invalid dependency
  it("no-orphan-nodes catches node with invalid dependency", () => {
    const dag = mkDAG([
      mkNode("a"),
      mkNode("b", ["ghost"]),
    ]);
    const result = evaluatePolicy(dag);
    const v = result.violations.find((v) => v.rule === "no-orphan-nodes");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(v!.nodeId).toBe("b");
  });
});
