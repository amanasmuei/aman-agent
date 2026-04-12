import { describe, it, expect } from "vitest";
import type { TaskDAG, TaskStatus } from "../../src/orchestrator/types.js";
import {
  DAGValidationError,
  validateDAG,
  topologicalSort,
  getReadyNodes,
  getDependents,
} from "../../src/orchestrator/dag.js";

// ── Test DAGs ───────────────────────────────────────────────────────

function mkNode(id: string, deps: string[] = []) {
  return {
    id,
    name: `Task ${id}`,
    profile: "developer",
    tier: "standard" as const,
    dependencies: deps,
  };
}

const LINEAR_DAG: TaskDAG = {
  id: "linear",
  name: "Linear",
  goal: "A then B then C",
  nodes: [mkNode("a"), mkNode("b", ["a"]), mkNode("c", ["b"])],
  gates: [],
};

const DIAMOND_DAG: TaskDAG = {
  id: "diamond",
  name: "Diamond",
  goal: "A fans out to B,C then converges at D",
  nodes: [
    mkNode("a"),
    mkNode("b", ["a"]),
    mkNode("c", ["a"]),
    mkNode("d", ["b", "c"]),
  ],
  gates: [],
};

const CYCLIC_DAG: TaskDAG = {
  id: "cyclic",
  name: "Cyclic",
  goal: "Should fail validation",
  nodes: [mkNode("a", ["c"]), mkNode("b", ["a"]), mkNode("c", ["b"])],
  gates: [],
};

const DUPLICATE_IDS_DAG: TaskDAG = {
  id: "dup",
  name: "Duplicate",
  goal: "Has duplicate node ids",
  nodes: [mkNode("a"), mkNode("a")],
  gates: [],
};

const MISSING_DEP_DAG: TaskDAG = {
  id: "missing",
  name: "Missing dep",
  goal: "References nonexistent node",
  nodes: [mkNode("a", ["z"])],
  gates: [],
};

const GATED_DAG: TaskDAG = {
  id: "gated",
  name: "Gated",
  goal: "Gate between phases",
  nodes: [mkNode("a"), mkNode("b"), mkNode("c", ["a"]), mkNode("d", ["b"])],
  gates: [
    {
      id: "gate-1",
      name: "Phase gate",
      type: "approval",
      afterNodes: ["a", "b"],
      beforeNodes: ["c", "d"],
    },
  ],
};

const BAD_GATE_DAG: TaskDAG = {
  id: "bad-gate",
  name: "Bad gate",
  goal: "Gate references nonexistent node",
  nodes: [mkNode("a")],
  gates: [
    {
      id: "gate-1",
      name: "Bad gate",
      type: "approval",
      afterNodes: ["a"],
      beforeNodes: ["nonexistent"],
    },
  ],
};

// ── Tests ───────────────────────────────────────────────────────────

describe("DAG operations", () => {
  describe("validateDAG", () => {
    it("accepts a linear DAG", () => {
      expect(() => validateDAG(LINEAR_DAG)).not.toThrow();
    });

    it("accepts a diamond DAG", () => {
      expect(() => validateDAG(DIAMOND_DAG)).not.toThrow();
    });

    it("rejects a cyclic DAG with 'cycle' in message", () => {
      expect(() => validateDAG(CYCLIC_DAG)).toThrow(DAGValidationError);
      expect(() => validateDAG(CYCLIC_DAG)).toThrow(/cycle/i);
    });

    it("rejects dependency on nonexistent node", () => {
      expect(() => validateDAG(MISSING_DEP_DAG)).toThrow(DAGValidationError);
      expect(() => validateDAG(MISSING_DEP_DAG)).toThrow(/nonexistent|unknown|not found/i);
    });

    it("rejects duplicate node ids", () => {
      expect(() => validateDAG(DUPLICATE_IDS_DAG)).toThrow(DAGValidationError);
      expect(() => validateDAG(DUPLICATE_IDS_DAG)).toThrow(/duplicate/i);
    });

    it("validates gate references", () => {
      expect(() => validateDAG(BAD_GATE_DAG)).toThrow(DAGValidationError);
    });

    it("accepts a DAG with valid gates", () => {
      expect(() => validateDAG(GATED_DAG)).not.toThrow();
    });
  });

  describe("topologicalSort", () => {
    it("returns [a, b, c] for linear DAG", () => {
      expect(topologicalSort(LINEAR_DAG)).toEqual(["a", "b", "c"]);
    });

    it("returns a first and d last for diamond DAG", () => {
      const sorted = topologicalSort(DIAMOND_DAG);
      expect(sorted[0]).toBe("a");
      expect(sorted[sorted.length - 1]).toBe("d");
      expect(sorted).toHaveLength(4);
    });
  });

  describe("getReadyNodes", () => {
    it("returns roots when all nodes are pending", () => {
      const statuses = new Map<string, TaskStatus>([
        ["a", "pending"],
        ["b", "pending"],
        ["c", "pending"],
      ]);
      expect(getReadyNodes(LINEAR_DAG, statuses)).toEqual(["a"]);
    });

    it("returns parallel nodes when shared dependency is completed", () => {
      const statuses = new Map<string, TaskStatus>([
        ["a", "completed"],
        ["b", "pending"],
        ["c", "pending"],
        ["d", "pending"],
      ]);
      const ready = getReadyNodes(DIAMOND_DAG, statuses);
      expect(ready).toContain("b");
      expect(ready).toContain("c");
      expect(ready).not.toContain("d");
    });

    it("returns sink when all predecessors are done", () => {
      const statuses = new Map<string, TaskStatus>([
        ["a", "completed"],
        ["b", "completed"],
        ["c", "completed"],
        ["d", "pending"],
      ]);
      expect(getReadyNodes(DIAMOND_DAG, statuses)).toEqual(["d"]);
    });

    it("does NOT return nodes with running dependencies", () => {
      const statuses = new Map<string, TaskStatus>([
        ["a", "running"],
        ["b", "pending"],
        ["c", "pending"],
      ]);
      expect(getReadyNodes(LINEAR_DAG, statuses)).toEqual([]);
    });

    it("blocks nodes behind an unresolved gate", () => {
      const statuses = new Map<string, TaskStatus>([
        ["a", "completed"],
        ["b", "completed"],
        ["c", "pending"],
        ["d", "pending"],
      ]);
      // afterNodes completed but gate NOT resolved => beforeNodes blocked
      const ready = getReadyNodes(GATED_DAG, statuses);
      expect(ready).not.toContain("c");
      expect(ready).not.toContain("d");
    });

    it("releases nodes when gate is resolved", () => {
      const statuses = new Map<string, TaskStatus>([
        ["a", "completed"],
        ["b", "completed"],
        ["c", "pending"],
        ["d", "pending"],
      ]);
      const resolved = new Set(["gate-1"]);
      const ready = getReadyNodes(GATED_DAG, statuses, resolved);
      expect(ready).toContain("c");
      expect(ready).toContain("d");
    });
  });

  describe("getDependents", () => {
    it("returns dependents of a node", () => {
      const deps = getDependents(DIAMOND_DAG, "a");
      expect(deps).toContain("b");
      expect(deps).toContain("c");
      expect(deps).not.toContain("d");
    });

    it("returns empty array for leaf node", () => {
      expect(getDependents(LINEAR_DAG, "c")).toEqual([]);
    });
  });
});
