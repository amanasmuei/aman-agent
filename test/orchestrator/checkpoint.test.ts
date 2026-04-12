import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TaskDAG,
  TaskStatus,
  TaskResult,
  OrchestrationStatus,
} from "../../src/orchestrator/types.js";
import {
  createCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
  restoreMaps,
} from "../../src/orchestrator/checkpoint.js";
import type { CheckpointData } from "../../src/orchestrator/checkpoint.js";

// ── Helpers ─────────────────────────────────────────────────────────────
const makeDag = (): TaskDAG => ({
  id: "dag-1",
  name: "Test DAG",
  goal: "Test checkpoint",
  nodes: [
    {
      id: "task-1",
      name: "Task 1",
      profile: "developer",
      tier: "standard" as const,
      dependencies: [],
    },
    {
      id: "task-2",
      name: "Task 2",
      profile: "developer",
      tier: "fast" as const,
      dependencies: ["task-1"],
    },
  ],
  gates: [
    {
      id: "gate-1",
      name: "Review Gate",
      type: "approval",
      afterNodes: ["task-1"],
      beforeNodes: ["task-2"],
    },
  ],
});

const makeTaskStatuses = (): Map<string, TaskStatus> =>
  new Map<string, TaskStatus>([
    ["task-1", "completed"],
    ["task-2", "running"],
  ]);

const makeTaskResults = (): Map<string, TaskResult> =>
  new Map<string, TaskResult>([
    [
      "task-1",
      {
        nodeId: "task-1",
        status: "completed",
        output: "done",
        toolsUsed: ["read", "write"],
        turns: 3,
        startedAt: 1000,
        completedAt: 2000,
        tier: "standard",
      },
    ],
  ]);

const makeResolvedGates = (): Set<string> => new Set(["gate-1"]);

// ── File-test cleanup ───────────────────────────────────────────────────
let tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs) {
    await rm(d, { recursive: true, force: true });
  }
  tempDirs = [];
});

async function makeTempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "checkpoint-test-"));
  tempDirs.push(d);
  return d;
}

// ── Tests ───────────────────────────────────────────────────────────────
describe("checkpoint", () => {
  // 1. createCheckpoint serializes Maps to Records
  it("serializes Maps to Records", () => {
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      "gate-1",
      1000,
    );

    expect(cp.taskStatuses).toEqual({
      "task-1": "completed",
      "task-2": "running",
    });
    expect(cp.taskResults).toEqual({
      "task-1": {
        nodeId: "task-1",
        status: "completed",
        output: "done",
        toolsUsed: ["read", "write"],
        turns: 3,
        startedAt: 1000,
        completedAt: 2000,
        tier: "standard",
      },
    });
    expect(cp.resolvedGates).toEqual(["gate-1"]);
  });

  // 2. createCheckpoint sets checkpointedAt to current time
  it("sets checkpointedAt to current time", () => {
    const before = Date.now();
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      null,
      1000,
    );
    const after = Date.now();

    expect(cp.checkpointedAt).toBeGreaterThanOrEqual(before);
    expect(cp.checkpointedAt).toBeLessThanOrEqual(after);
  });

  // 3. serializeCheckpoint produces valid JSON
  it("serializeCheckpoint produces valid JSON", () => {
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      null,
      1000,
    );
    const json = serializeCheckpoint(cp);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  // 4. deserializeCheckpoint restores checkpoint
  it("deserializeCheckpoint restores checkpoint", () => {
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      "gate-1",
      1000,
    );
    const json = serializeCheckpoint(cp);
    const restored = deserializeCheckpoint(json);

    expect(restored.orchestrationId).toBe("orch-1");
    expect(restored.version).toBe(1);
    expect(restored.status).toBe("running");
    expect(restored.activeGate).toBe("gate-1");
    expect(restored.startedAt).toBe(1000);
  });

  // 5. round-trip: serialize → deserialize preserves all data
  it("round-trip preserves all data", () => {
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      "gate-1",
      1000,
    );
    const restored = deserializeCheckpoint(serializeCheckpoint(cp));

    expect(restored).toEqual(cp);
  });

  // 6. restoreMaps converts Records back to Maps/Sets
  it("restoreMaps converts Records back to Maps/Sets", () => {
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      null,
      1000,
    );
    const { taskStatuses, taskResults, resolvedGates } = restoreMaps(cp);

    expect(taskStatuses).toBeInstanceOf(Map);
    expect(taskResults).toBeInstanceOf(Map);
    expect(resolvedGates).toBeInstanceOf(Set);

    expect(taskStatuses.get("task-1")).toBe("completed");
    expect(taskStatuses.get("task-2")).toBe("running");
    expect(taskResults.get("task-1")?.output).toBe("done");
    expect(resolvedGates.has("gate-1")).toBe(true);
  });

  // 7. saveCheckpoint writes file to disk
  it("saveCheckpoint writes file to disk", async () => {
    const dir = await makeTempDir();
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      null,
      1000,
    );
    const filePath = await saveCheckpoint(cp, dir);

    expect(filePath).toBe(join(dir, "checkpoint-orch-1.json"));

    // Verify the file is valid JSON containing our data
    const { readFile } = await import("node:fs/promises");
    const contents = JSON.parse(await readFile(filePath, "utf-8"));
    expect(contents.orchestrationId).toBe("orch-1");
  });

  // 8. loadCheckpoint reads file back
  it("loadCheckpoint reads file back", async () => {
    const dir = await makeTempDir();
    const cp = createCheckpoint(
      "orch-1",
      makeDag(),
      "running",
      makeTaskStatuses(),
      makeTaskResults(),
      makeResolvedGates(),
      "gate-1",
      1000,
    );
    await saveCheckpoint(cp, dir);
    const loaded = await loadCheckpoint("orch-1", dir);

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(cp);
  });

  // 9. loadCheckpoint returns null for missing file
  it("loadCheckpoint returns null for missing file", async () => {
    const dir = await makeTempDir();
    const loaded = await loadCheckpoint("nonexistent", dir);
    expect(loaded).toBeNull();
  });

  // 10. deserializeCheckpoint throws on invalid JSON
  it("deserializeCheckpoint throws on invalid JSON", () => {
    expect(() => deserializeCheckpoint("not valid json")).toThrow();
  });

  // 11. createCheckpoint stores version, orchestrationId, updatedAt
  it("stores metadata fields correctly", () => {
    const cp = createCheckpoint(
      "orch-42",
      makeDag(),
      "paused",
      new Map(),
      new Map(),
      new Set(),
      null,
      5000,
    );

    expect(cp.version).toBe(1);
    expect(cp.orchestrationId).toBe("orch-42");
    expect(cp.updatedAt).toBeGreaterThanOrEqual(cp.startedAt);
    expect(cp.dag.id).toBe("dag-1");
  });
});
