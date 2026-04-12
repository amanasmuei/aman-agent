import { describe, it, expect } from "vitest";
import { validateDAG } from "../../../src/orchestrator/dag.js";
import {
  fullFeatureTemplate,
  bugFixTemplate,
  securityAuditTemplate,
  getTemplate,
  listTemplates,
} from "../../../src/orchestrator/templates/index.js";

// ── fullFeatureTemplate ────────────────────────────────────────────

describe("fullFeatureTemplate", () => {
  const base = { name: "widget", goal: "Build the widget feature" };

  it("returns a valid DAG (validateDAG does not throw)", () => {
    const dag = fullFeatureTemplate(base);
    expect(() => validateDAG(dag)).not.toThrow();
  });

  it("has correct number of nodes (5)", () => {
    const dag = fullFeatureTemplate(base);
    expect(dag.nodes).toHaveLength(5);
  });

  it("includes approval gate when requireApproval=true", () => {
    const dag = fullFeatureTemplate({ ...base, requireApproval: true });
    expect(dag.gates).toHaveLength(1);
    expect(dag.gates[0].type).toBe("approval");
  });

  it("has no gates when requireApproval=false", () => {
    const dag = fullFeatureTemplate({ ...base, requireApproval: false });
    expect(dag.gates).toHaveLength(0);
  });

  it("defaults to no gates when requireApproval is omitted", () => {
    const dag = fullFeatureTemplate(base);
    expect(dag.gates).toHaveLength(0);
  });

  it("sets name and goal from options", () => {
    const dag = fullFeatureTemplate(base);
    expect(dag.name).toContain("widget");
    expect(dag.goal).toBe("Build the widget feature");
  });

  it("has design node with no dependencies (root)", () => {
    const dag = fullFeatureTemplate(base);
    const design = dag.nodes.find((n) => n.id === "design");
    expect(design).toBeDefined();
    expect(design!.dependencies).toEqual([]);
    expect(design!.profile).toBe("architect");
    expect(design!.tier).toBe("advanced");
  });

  it("has implement depending on design", () => {
    const dag = fullFeatureTemplate(base);
    const impl = dag.nodes.find((n) => n.id === "implement");
    expect(impl).toBeDefined();
    expect(impl!.dependencies).toEqual(["design"]);
  });

  it("has review and test depending on implement", () => {
    const dag = fullFeatureTemplate(base);
    const review = dag.nodes.find((n) => n.id === "review");
    const test = dag.nodes.find((n) => n.id === "test");
    expect(review!.dependencies).toEqual(["implement"]);
    expect(test!.dependencies).toEqual(["implement"]);
  });

  it("has finalize depending on review and test", () => {
    const dag = fullFeatureTemplate(base);
    const finalize = dag.nodes.find((n) => n.id === "finalize");
    expect(finalize!.dependencies).toContain("review");
    expect(finalize!.dependencies).toContain("test");
  });

  it("approval gate references correct afterNodes and beforeNodes", () => {
    const dag = fullFeatureTemplate({ ...base, requireApproval: true });
    const gate = dag.gates[0];
    expect(gate.afterNodes).toContain("review");
    expect(gate.afterNodes).toContain("test");
    expect(gate.beforeNodes).toContain("finalize");
  });
});

// ── bugFixTemplate ─────────────────────────────────────────────────

describe("bugFixTemplate", () => {
  const base = { name: "crash-bug", goal: "Fix the crash on startup" };

  it("returns a valid DAG", () => {
    const dag = bugFixTemplate(base);
    expect(() => validateDAG(dag)).not.toThrow();
  });

  it("has correct node flow without approval", () => {
    const dag = bugFixTemplate(base);
    // reproduce → fix → test → review (4 nodes)
    expect(dag.nodes).toHaveLength(4);
    const ids = dag.nodes.map((n) => n.id);
    expect(ids).toContain("reproduce");
    expect(ids).toContain("fix");
    expect(ids).toContain("test");
    expect(ids).toContain("review");
  });

  it("has no gates when requireApproval is omitted", () => {
    const dag = bugFixTemplate(base);
    expect(dag.gates).toHaveLength(0);
  });

  it("adds verify step and gate when requireApproval=true", () => {
    const dag = bugFixTemplate({ ...base, requireApproval: true });
    // reproduce → fix → test → review → [gate] → verify
    expect(dag.nodes).toHaveLength(5);
    const verify = dag.nodes.find((n) => n.id === "verify");
    expect(verify).toBeDefined();
    expect(dag.gates).toHaveLength(1);
    expect(dag.gates[0].type).toBe("approval");
    expect(dag.gates[0].afterNodes).toContain("review");
    expect(dag.gates[0].beforeNodes).toContain("verify");
  });

  it("has correct dependency chain", () => {
    const dag = bugFixTemplate(base);
    const reproduce = dag.nodes.find((n) => n.id === "reproduce")!;
    const fix = dag.nodes.find((n) => n.id === "fix")!;
    const test = dag.nodes.find((n) => n.id === "test")!;
    const review = dag.nodes.find((n) => n.id === "review")!;
    expect(reproduce.dependencies).toEqual([]);
    expect(fix.dependencies).toEqual(["reproduce"]);
    expect(test.dependencies).toEqual(["fix"]);
    expect(review.dependencies).toEqual(["test"]);
  });
});

// ── securityAuditTemplate ──────────────────────────────────────────

describe("securityAuditTemplate", () => {
  const base = { name: "q2-audit", goal: "Quarterly security audit" };

  it("returns a valid DAG", () => {
    const dag = securityAuditTemplate(base);
    expect(() => validateDAG(dag)).not.toThrow();
  });

  it("has 5 nodes: scan, triage, fix, rescan, review", () => {
    const dag = securityAuditTemplate(base);
    expect(dag.nodes).toHaveLength(5);
    const ids = dag.nodes.map((n) => n.id);
    expect(ids).toEqual(["scan", "triage", "fix", "rescan", "review"]);
  });

  it("has no gates when requireApproval is omitted", () => {
    const dag = securityAuditTemplate(base);
    expect(dag.gates).toHaveLength(0);
  });

  it("gates fix step behind approval when requireApproval=true", () => {
    const dag = securityAuditTemplate({ ...base, requireApproval: true });
    expect(dag.gates).toHaveLength(1);
    const gate = dag.gates[0];
    expect(gate.type).toBe("approval");
    expect(gate.afterNodes).toContain("triage");
    expect(gate.beforeNodes).toContain("fix");
  });

  it("has correct dependency chain", () => {
    const dag = securityAuditTemplate(base);
    const scan = dag.nodes.find((n) => n.id === "scan")!;
    const triage = dag.nodes.find((n) => n.id === "triage")!;
    const fix = dag.nodes.find((n) => n.id === "fix")!;
    const rescan = dag.nodes.find((n) => n.id === "rescan")!;
    const review = dag.nodes.find((n) => n.id === "review")!;
    expect(scan.dependencies).toEqual([]);
    expect(triage.dependencies).toEqual(["scan"]);
    expect(fix.dependencies).toEqual(["triage"]);
    expect(rescan.dependencies).toEqual(["fix"]);
    expect(review.dependencies).toEqual(["rescan"]);
  });
});

// ── getTemplate ────────────────────────────────────────────────────

describe("getTemplate", () => {
  it("returns function for known templates", () => {
    expect(getTemplate("full-feature")).toBeTypeOf("function");
    expect(getTemplate("bug-fix")).toBeTypeOf("function");
    expect(getTemplate("security-audit")).toBeTypeOf("function");
  });

  it("returns undefined for unknown template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});

// ── listTemplates ──────────────────────────────────────────────────

describe("listTemplates", () => {
  it("returns all 3 template names", () => {
    const names = listTemplates();
    expect(names).toHaveLength(3);
    expect(names).toContain("full-feature");
    expect(names).toContain("bug-fix");
    expect(names).toContain("security-audit");
  });
});
