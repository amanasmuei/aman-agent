import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskDAG } from "../../src/orchestrator/types.js";
import type { SchedulerResult } from "../../src/orchestrator/scheduler.js";
import type { FullOrchestrationResult } from "../../src/orchestrator/runner.js";

// ── Mock data ─────────────────────────────────────────────────────────

const MOCK_DAG: TaskDAG = {
  id: "orch-1",
  name: "Feature",
  goal: "Build it",
  nodes: [
    { id: "t1", name: "Task 1", profile: "coder", tier: "standard", dependencies: [] },
  ],
  gates: [],
};

const TEMPLATE_DAG: TaskDAG = {
  id: "full-feature-Orchestration",
  name: "Full Feature: Orchestration",
  goal: "Build it",
  nodes: [
    { id: "design", name: "Design", profile: "architect", tier: "advanced", dependencies: [] },
    { id: "implement", name: "Implement", profile: "coder", tier: "standard", dependencies: ["design"] },
    { id: "review", name: "Review", profile: "reviewer", tier: "standard", dependencies: ["implement"] },
    { id: "test", name: "Test", profile: "tester", tier: "standard", dependencies: ["implement"] },
    { id: "finalize", name: "Finalize", profile: "coder", tier: "standard", dependencies: ["review", "test"] },
  ],
  gates: [],
};

const MOCK_SCHEDULER_RESULT: SchedulerResult = {
  status: "completed",
  taskResults: new Map(),
  auditLog: { orchestrationId: "t", events: [] },
  durationMs: 100,
};

const MOCK_ORCH_RESULT: FullOrchestrationResult = {
  scheduler: MOCK_SCHEDULER_RESULT,
  success: true,
  durationMs: 100,
};

// ── Mocks ─────────────────────────────────────────────────────────────

const mockRunOrchestrationFull = vi.fn(async () => MOCK_ORCH_RESULT);
vi.mock("../../src/orchestrator/runner.js", () => ({
  runOrchestrationFull: (...args: unknown[]) => mockRunOrchestrationFull(...args),
}));

const mockDecomposeRequirement = vi.fn(async () => MOCK_DAG);
vi.mock("../../src/orchestrator/decompose.js", () => ({
  decomposeRequirement: (...args: unknown[]) => mockDecomposeRequirement(...args),
}));

const mockGetTemplate = vi.fn();
vi.mock("../../src/orchestrator/templates/index.js", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

const mockClassifyProject = vi.fn(() => ({
  type: "api-backend",
  confidence: 0.9,
  suggestedTemplate: "full-feature",
  suggestedProfiles: ["architect", "coder"],
  description: "API",
}));
vi.mock("../../src/project/detector.js", () => ({
  classifyProject: (...args: unknown[]) => mockClassifyProject(...args),
  getRecommendedTemplate: vi.fn(() => "full-feature"),
}));

const mockScanStack = vi.fn(() => ({
  projectName: "test",
  languages: ["typescript"],
  frameworks: ["express"],
  databases: [],
  infra: [],
  isMonorepo: false,
  detectedAt: Date.now(),
}));
vi.mock("../../src/dev/stack-detector.js", () => ({
  scanStack: (...args: unknown[]) => mockScanStack(...args),
}));

const mockEnsureAllProfilesInstalled = vi.fn(() => ({
  installed: [],
  skipped: ["architect", "security", "tester", "reviewer"],
}));
const mockGetProfilesDir = vi.fn(() => "/tmp/profiles");
vi.mock("../../src/profiles/auto-install.js", () => ({
  ensureAllProfilesInstalled: (...args: unknown[]) => mockEnsureAllProfilesInstalled(...args),
  getProfilesDir: () => mockGetProfilesDir(),
}));

vi.mock("../../src/delegate.js", () => ({ delegateTask: vi.fn() }));
vi.mock("../../src/delegate-remote.js", () => ({ delegateRemote: vi.fn() }));

// ── Import SUT ────────────────────────────────────────────────────────

import {
  smartOrchestrate,
  formatSmartResult,
  type SmartOrchestrationOptions,
} from "../../src/orchestrator/smart-orchestrate.js";
import type { LLMClient } from "../../src/llm/types.js";
import type { ModelRouter } from "../../src/orchestrator/model-router.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeFakeClient(): LLMClient {
  return { chat: vi.fn() } as unknown as LLMClient;
}

function makeFakeRouter(): ModelRouter {
  return { route: vi.fn() } as unknown as ModelRouter;
}

function baseOptions(overrides?: Partial<SmartOrchestrationOptions>): SmartOrchestrationOptions {
  return {
    requirement: "Build a REST API",
    client: makeFakeClient(),
    router: makeFakeRouter(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("smartOrchestrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockReturnValue(undefined);
    mockRunOrchestrationFull.mockResolvedValue(MOCK_ORCH_RESULT);
    mockDecomposeRequirement.mockResolvedValue(MOCK_DAG);
  });

  it("decomposes requirement via LLM when no template specified", async () => {
    const result = await smartOrchestrate(baseOptions());

    expect(mockDecomposeRequirement).toHaveBeenCalledWith(
      "Build a REST API",
      expect.anything(),
    );
    expect(result.dag).toBe(MOCK_DAG);
    expect(result.templateUsed).toBeUndefined();
  });

  it("uses template when templateName provided and template exists", async () => {
    const templateFn = vi.fn(() => TEMPLATE_DAG);
    mockGetTemplate.mockReturnValue(templateFn);

    const result = await smartOrchestrate(
      baseOptions({ templateName: "full-feature" }),
    );

    expect(mockGetTemplate).toHaveBeenCalledWith("full-feature");
    expect(templateFn).toHaveBeenCalledWith({
      name: "Orchestration",
      goal: "Build a REST API",
    });
    expect(result.dag).toBe(TEMPLATE_DAG);
    expect(result.templateUsed).toBe("full-feature");
    expect(mockDecomposeRequirement).not.toHaveBeenCalled();
  });

  it("auto-detects project type and selects template when projectPath provided", async () => {
    const templateFn = vi.fn(() => TEMPLATE_DAG);
    mockGetTemplate.mockReturnValue(templateFn);

    const result = await smartOrchestrate(
      baseOptions({ projectPath: "/my/project" }),
    );

    expect(mockScanStack).toHaveBeenCalledWith("/my/project");
    expect(mockClassifyProject).toHaveBeenCalled();
    expect(result.projectType).toBe("api-backend");
    expect(result.templateUsed).toBe("full-feature");
    expect(mockDecomposeRequirement).not.toHaveBeenCalled();
  });

  it("falls back to LLM decompose when template not found", async () => {
    mockGetTemplate.mockReturnValue(undefined);

    const result = await smartOrchestrate(
      baseOptions({ templateName: "nonexistent-template" }),
    );

    expect(mockGetTemplate).toHaveBeenCalledWith("nonexistent-template");
    expect(mockDecomposeRequirement).toHaveBeenCalled();
    expect(result.dag).toBe(MOCK_DAG);
  });

  it("ensures profiles are installed before running", async () => {
    await smartOrchestrate(baseOptions());

    expect(mockEnsureAllProfilesInstalled).toHaveBeenCalledWith("/tmp/profiles");
    // Profiles installed before runner called
    const profileCallOrder = mockEnsureAllProfilesInstalled.mock.invocationCallOrder[0];
    const runnerCallOrder = mockRunOrchestrationFull.mock.invocationCallOrder[0];
    expect(profileCallOrder).toBeLessThan(runnerCallOrder);
  });

  it("passes enterprise options through to runner", async () => {
    await smartOrchestrate(
      baseOptions({
        enablePolicyCheck: true,
        enableSelfReview: true,
        enableCostTracking: true,
        budgetLimit: 5.0,
      }),
    );

    expect(mockRunOrchestrationFull).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        enablePolicyCheck: true,
        enableSelfReview: true,
        enableCostTracking: true,
        budgetLimit: 5.0,
      }),
    );
  });

  it("passes callbacks through to runner", async () => {
    const cb = { onTaskStarted: vi.fn() };
    await smartOrchestrate(baseOptions({ callbacks: cb }));

    expect(mockRunOrchestrationFull).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ callbacks: cb }),
    );
  });

  it("returns summary string in result", async () => {
    const result = await smartOrchestrate(baseOptions());

    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain("completed");
  });

  it("explicit templateName overrides projectPath auto-detection", async () => {
    const templateFn = vi.fn(() => TEMPLATE_DAG);
    mockGetTemplate.mockReturnValue(templateFn);

    const result = await smartOrchestrate(
      baseOptions({ projectPath: "/my/project", templateName: "bug-fix" }),
    );

    // Should NOT scan stack when templateName is explicitly provided
    expect(mockScanStack).not.toHaveBeenCalled();
    expect(mockGetTemplate).toHaveBeenCalledWith("bug-fix");
    expect(result.templateUsed).toBe("bug-fix");
  });
});

describe("formatSmartResult", () => {
  it("includes project type and template info", () => {
    const output = formatSmartResult({
      dag: MOCK_DAG,
      projectType: "api-backend",
      templateUsed: "full-feature",
      orchestration: MOCK_ORCH_RESULT,
      summary: "",
    });

    expect(output).toContain("Project type: api-backend");
    expect(output).toContain("Template: full-feature");
  });

  it("shows status and duration", () => {
    const output = formatSmartResult({
      dag: MOCK_DAG,
      orchestration: MOCK_ORCH_RESULT,
      summary: "",
    });

    expect(output).toContain("Status: completed");
    expect(output).toContain("100ms");
  });

  it("shows policy failure info", () => {
    const output = formatSmartResult({
      dag: MOCK_DAG,
      orchestration: {
        ...MOCK_ORCH_RESULT,
        success: false,
        policy: {
          passed: false,
          violations: [
            { rule: "test", message: "Bad DAG", severity: "error" },
            { rule: "test2", message: "Warning", severity: "warning" },
          ],
        },
      },
      summary: "",
    });

    expect(output).toContain("Policy: FAILED");
    expect(output).toContain("1 error");
  });

  it("shows review and cost info when present", () => {
    const output = formatSmartResult({
      dag: MOCK_DAG,
      orchestration: {
        ...MOCK_ORCH_RESULT,
        review: { passed: true, issues: [], reviewDag: MOCK_DAG },
        costSummary: "$0.05 total",
      },
      summary: "",
    });

    expect(output).toContain("Review: passed");
    expect(output).toContain("Cost: $0.05 total");
  });

  it("omits optional fields when not present", () => {
    const output = formatSmartResult({
      dag: MOCK_DAG,
      orchestration: MOCK_ORCH_RESULT,
      summary: "",
    });

    expect(output).not.toContain("Project type:");
    expect(output).not.toContain("Template:");
    expect(output).not.toContain("Policy:");
    expect(output).not.toContain("Review:");
    expect(output).not.toContain("Cost:");
  });
});
