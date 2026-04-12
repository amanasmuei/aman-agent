import { describe, it, expect, vi } from "vitest";

vi.mock("../src/orchestrator/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/orchestrator/index.js")>();
  return {
    ...actual,
    decomposeRequirement: vi.fn(async () => ({
      id: "orch-test",
      name: "Test Feature",
      goal: "Build test feature",
      nodes: [
        { id: "t1", name: "Design API", profile: "architect", tier: "advanced", dependencies: [] },
        { id: "t2", name: "Implement", profile: "coder", tier: "standard", dependencies: ["t1"] },
        { id: "t3", name: "Write tests", profile: "tester", tier: "standard", dependencies: ["t2"] },
      ],
      gates: [
        { id: "g1", name: "Review design", type: "approval", afterNodes: ["t1"], beforeNodes: ["t2"] },
      ],
    })),
  };
});

import { decomposeRequirement, formatDAGForDisplay } from "../src/orchestrator/index.js";

describe("/orchestrate command", () => {
  it("decomposeRequirement returns valid DAG", async () => {
    const dag = await (decomposeRequirement as ReturnType<typeof vi.fn>)("Build auth", null);
    expect(dag.nodes).toHaveLength(3);
    expect(dag.gates).toHaveLength(1);
    expect(dag.nodes[0].profile).toBe("architect");
    expect(dag.nodes[1].dependencies).toEqual(["t1"]);
  });

  it("formatDAGForDisplay produces readable output", async () => {
    const dag = await (decomposeRequirement as ReturnType<typeof vi.fn>)("Build auth", null);
    const output = formatDAGForDisplay(dag);

    expect(output).toContain("## Test Feature");
    expect(output).toContain("**Goal:** Build test feature");
    expect(output).toContain("**Tasks:** 3 | **Gates:** 1");
    expect(output).toContain("**Design API**");
    expect(output).toContain("architect [advanced]");
    expect(output).toContain("(root)");
    expect(output).toContain("(after: t1)");
    expect(output).toContain("**Review design** [approval]");
  });

  it("formatDAGForDisplay handles DAG with no gates", () => {
    const dag = {
      id: "orch-simple",
      name: "Simple Task",
      goal: "Do something simple",
      nodes: [
        { id: "t1", name: "Do it", profile: "coder", tier: "fast" as const, dependencies: [] },
      ],
      gates: [],
    };
    const output = formatDAGForDisplay(dag);

    expect(output).toContain("**Tasks:** 1 | **Gates:** 0");
    expect(output).not.toContain("\uD83D\uDD12");
  });

  it("formatDAGForDisplay shows multiple dependencies", () => {
    const dag = {
      id: "orch-multi",
      name: "Multi Dep",
      goal: "Test multiple deps",
      nodes: [
        { id: "t1", name: "Task A", profile: "coder", tier: "fast" as const, dependencies: [] },
        { id: "t2", name: "Task B", profile: "coder", tier: "fast" as const, dependencies: [] },
        { id: "t3", name: "Task C", profile: "coder", tier: "standard" as const, dependencies: ["t1", "t2"] },
      ],
      gates: [],
    };
    const output = formatDAGForDisplay(dag);

    expect(output).toContain("(after: t1, t2)");
  });
});
