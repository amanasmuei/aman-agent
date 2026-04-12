import { describe, it, expect } from "vitest";
import {
  ModelTierEnum,
  TaskNodeSchema,
  TaskDAGSchema,
  PhaseGateSchema,
  PhaseGateTypeEnum,
  OrchestrationStatusEnum,
  TaskStatusEnum,
  OrchestrationConfigSchema,
} from "../../src/orchestrator/types.js";
import type {
  TaskNode,
  TaskDAG,
  PhaseGate,
  ModelTier,
  PhaseGateType,
  OrchestrationStatus,
  TaskStatus,
  TaskResult,
  OrchestrationState,
  OrchestrationConfig,
} from "../../src/orchestrator/types.js";

describe("orchestrator types", () => {
  describe("TaskNodeSchema", () => {
    const validNode = {
      id: "task-1",
      name: "Implement feature",
      profile: "developer",
      tier: "standard" as const,
    };

    it("accepts a valid node", () => {
      const result = TaskNodeSchema.parse(validNode);
      expect(result.id).toBe("task-1");
      expect(result.name).toBe("Implement feature");
      expect(result.profile).toBe("developer");
      expect(result.tier).toBe("standard");
    });

    it("rejects without id", () => {
      const { id, ...noId } = validNode;
      expect(() => TaskNodeSchema.parse(noId)).toThrow();
    });

    it("rejects empty id", () => {
      expect(() => TaskNodeSchema.parse({ ...validNode, id: "" })).toThrow();
    });

    it("rejects invalid tier", () => {
      expect(() =>
        TaskNodeSchema.parse({ ...validNode, tier: "turbo" }),
      ).toThrow();
    });

    it("defaults dependencies to []", () => {
      const result = TaskNodeSchema.parse(validNode);
      expect(result.dependencies).toEqual([]);
    });

    it("accepts optional fields", () => {
      const result = TaskNodeSchema.parse({
        ...validNode,
        description: "Some work",
        phase: "phase-1",
        context: "extra context",
        metadata: { priority: 1 },
      });
      expect(result.description).toBe("Some work");
      expect(result.phase).toBe("phase-1");
      expect(result.context).toBe("extra context");
      expect(result.metadata).toEqual({ priority: 1 });
    });
  });

  describe("TaskDAGSchema", () => {
    const validDAG = {
      id: "dag-1",
      name: "Feature implementation",
      goal: "Build the orchestrator",
      nodes: [
        {
          id: "task-1",
          name: "Write types",
          profile: "developer",
          tier: "fast" as const,
        },
      ],
    };

    it("accepts a valid DAG", () => {
      const result = TaskDAGSchema.parse(validDAG);
      expect(result.id).toBe("dag-1");
      expect(result.nodes).toHaveLength(1);
      expect(result.gates).toEqual([]);
    });

    it("rejects DAG with no nodes", () => {
      expect(() =>
        TaskDAGSchema.parse({ ...validDAG, nodes: [] }),
      ).toThrow();
    });

    it("rejects DAG without goal", () => {
      const { goal, ...noGoal } = validDAG;
      expect(() => TaskDAGSchema.parse(noGoal)).toThrow();
    });

    it("defaults gates to []", () => {
      const result = TaskDAGSchema.parse(validDAG);
      expect(result.gates).toEqual([]);
    });
  });

  describe("PhaseGateSchema", () => {
    const validGate = {
      id: "gate-1",
      name: "Approval gate",
      type: "approval" as const,
      afterNodes: ["task-1"],
      beforeNodes: ["task-2"],
    };

    it("accepts a valid gate", () => {
      const result = PhaseGateSchema.parse(validGate);
      expect(result.id).toBe("gate-1");
      expect(result.type).toBe("approval");
    });

    it("accepts ci_pass type", () => {
      const result = PhaseGateSchema.parse({
        ...validGate,
        type: "ci_pass",
      });
      expect(result.type).toBe("ci_pass");
    });

    it("accepts test_pass type", () => {
      const result = PhaseGateSchema.parse({
        ...validGate,
        type: "test_pass",
      });
      expect(result.type).toBe("test_pass");
    });

    it("accepts custom type", () => {
      const result = PhaseGateSchema.parse({
        ...validGate,
        type: "custom",
      });
      expect(result.type).toBe("custom");
    });

    it("rejects invalid type", () => {
      expect(() =>
        PhaseGateSchema.parse({ ...validGate, type: "invalid" }),
      ).toThrow();
    });
  });

  describe("OrchestrationConfigSchema", () => {
    it("has sensible defaults", () => {
      const result = OrchestrationConfigSchema.parse({});
      expect(result.maxParallelTasks).toBe(4);
      expect(result.defaultTier).toBe("standard");
      expect(result.requireApprovalForPhaseTransition).toBe(true);
      expect(result.taskTimeoutMs).toBe(300_000);
      expect(result.orchestrationTimeoutMs).toBe(3_600_000);
    });

    it("accepts overrides", () => {
      const result = OrchestrationConfigSchema.parse({
        maxParallelTasks: 8,
        defaultTier: "fast",
        requireApprovalForPhaseTransition: false,
        taskTimeoutMs: 60_000,
        orchestrationTimeoutMs: 600_000,
      });
      expect(result.maxParallelTasks).toBe(8);
      expect(result.defaultTier).toBe("fast");
      expect(result.requireApprovalForPhaseTransition).toBe(false);
    });

    it("rejects non-positive maxParallelTasks", () => {
      expect(() =>
        OrchestrationConfigSchema.parse({ maxParallelTasks: 0 }),
      ).toThrow();
      expect(() =>
        OrchestrationConfigSchema.parse({ maxParallelTasks: -1 }),
      ).toThrow();
    });
  });

  describe("enums", () => {
    it("ModelTierEnum has expected values", () => {
      expect(ModelTierEnum.options).toEqual(["fast", "standard", "advanced"]);
    });

    it("OrchestrationStatusEnum has expected values", () => {
      expect(OrchestrationStatusEnum.options).toEqual([
        "pending",
        "running",
        "awaiting_approval",
        "approved",
        "paused",
        "completed",
        "failed",
        "cancelled",
      ]);
    });

    it("TaskStatusEnum has expected values", () => {
      expect(TaskStatusEnum.options).toEqual([
        "pending",
        "ready",
        "running",
        "completed",
        "failed",
        "skipped",
        "blocked",
      ]);
    });
  });
});
