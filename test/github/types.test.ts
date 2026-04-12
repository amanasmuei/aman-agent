import { describe, it, expect } from "vitest";
import {
  GitHubIssueSchema,
  GitHubPRSchema,
  WorkflowRunSchema,
  CheckStatusSchema,
  GhResultSchema,
} from "../../src/github/types.js";

// ---------- helpers ----------
function validIssue() {
  return {
    number: 42,
    title: "Fix the widget",
    body: "It is broken",
    state: "OPEN" as const,
    url: "https://github.com/owner/repo/issues/42",
    labels: [{ name: "bug" }],
    assignees: [{ login: "alice" }],
    author: { login: "bob" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  };
}

function validPR() {
  return {
    number: 7,
    title: "Add feature X",
    body: "Implements feature X",
    state: "OPEN" as const,
    url: "https://github.com/owner/repo/pull/7",
    headRefName: "feature-x",
    baseRefName: "main",
    isDraft: false,
    mergeable: "MERGEABLE" as const,
    labels: [{ name: "enhancement" }],
    author: { login: "carol" },
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-02T00:00:00Z",
  };
}

function validWorkflowRun() {
  return {
    databaseId: 100,
    name: "CI",
    workflowName: "CI Pipeline",
    status: "completed" as const,
    conclusion: "success" as const,
    url: "https://github.com/owner/repo/actions/runs/100",
    headBranch: "main",
    event: "push",
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-01T01:00:00Z",
  };
}

function validCheckStatus() {
  return {
    passed: true,
    pending: false,
    failing: false,
    total: 3,
    details: [
      { name: "lint", status: "completed", conclusion: "success" },
      { name: "test", status: "completed", conclusion: "success" },
      { name: "build", status: "completed", conclusion: "success" },
    ],
  };
}

// ---------- GitHubIssueSchema ----------
describe("GitHubIssueSchema", () => {
  it("accepts a valid issue", () => {
    const result = GitHubIssueSchema.parse(validIssue());
    expect(result.number).toBe(42);
    expect(result.title).toBe("Fix the widget");
    expect(result.state).toBe("OPEN");
  });

  it("rejects missing number", () => {
    const { number: _, ...noNumber } = validIssue();
    expect(() => GitHubIssueSchema.parse(noNumber)).toThrow();
  });

  it("defaults labels to []", () => {
    const { labels: _, ...noLabels } = validIssue();
    const result = GitHubIssueSchema.parse(noLabels);
    expect(result.labels).toEqual([]);
  });

  it("defaults body to null", () => {
    const { body: _, ...noBody } = validIssue();
    const result = GitHubIssueSchema.parse(noBody);
    expect(result.body).toBeNull();
  });

  it("defaults assignees to []", () => {
    const { assignees: _, ...noAssignees } = validIssue();
    const result = GitHubIssueSchema.parse(noAssignees);
    expect(result.assignees).toEqual([]);
  });
});

// ---------- GitHubPRSchema ----------
describe("GitHubPRSchema", () => {
  it("accepts a valid PR", () => {
    const result = GitHubPRSchema.parse(validPR());
    expect(result.number).toBe(7);
    expect(result.headRefName).toBe("feature-x");
  });

  it("accepts MERGED state", () => {
    const pr = { ...validPR(), state: "MERGED" as const };
    const result = GitHubPRSchema.parse(pr);
    expect(result.state).toBe("MERGED");
  });

  it("defaults isDraft to false", () => {
    const { isDraft: _, ...noDraft } = validPR();
    const result = GitHubPRSchema.parse(noDraft);
    expect(result.isDraft).toBe(false);
  });

  it("defaults mergeable to UNKNOWN", () => {
    const { mergeable: _, ...noMergeable } = validPR();
    const result = GitHubPRSchema.parse(noMergeable);
    expect(result.mergeable).toBe("UNKNOWN");
  });

  it("rejects invalid state", () => {
    const pr = { ...validPR(), state: "DRAFT" };
    expect(() => GitHubPRSchema.parse(pr)).toThrow();
  });
});

// ---------- WorkflowRunSchema ----------
describe("WorkflowRunSchema", () => {
  it("accepts a valid run", () => {
    const result = WorkflowRunSchema.parse(validWorkflowRun());
    expect(result.databaseId).toBe(100);
    expect(result.conclusion).toBe("success");
  });

  it("accepts null conclusion", () => {
    const run = { ...validWorkflowRun(), conclusion: null };
    const result = WorkflowRunSchema.parse(run);
    expect(result.conclusion).toBeNull();
  });

  it("validates status enum", () => {
    const run = { ...validWorkflowRun(), status: "invalid_status" };
    expect(() => WorkflowRunSchema.parse(run)).toThrow();
  });

  it("defaults conclusion to null when omitted", () => {
    const { conclusion: _, ...noConcl } = validWorkflowRun();
    const result = WorkflowRunSchema.parse(noConcl);
    expect(result.conclusion).toBeNull();
  });
});

// ---------- CheckStatusSchema ----------
describe("CheckStatusSchema", () => {
  it("accepts valid status", () => {
    const result = CheckStatusSchema.parse(validCheckStatus());
    expect(result.passed).toBe(true);
    expect(result.total).toBe(3);
    expect(result.details).toHaveLength(3);
  });

  it("defaults details to []", () => {
    const { details: _, ...noDetails } = validCheckStatus();
    const result = CheckStatusSchema.parse(noDetails);
    expect(result.details).toEqual([]);
  });

  it("rejects negative total", () => {
    const status = { ...validCheckStatus(), total: -1 };
    expect(() => CheckStatusSchema.parse(status)).toThrow();
  });
});

// ---------- GhResultSchema ----------
describe("GhResultSchema", () => {
  it("accepts a success result", () => {
    const result = GhResultSchema.parse({
      success: true,
      stdout: '{"number":1}',
      stderr: "",
      exitCode: 0,
    });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("accepts a failure result", () => {
    const result = GhResultSchema.parse({
      success: false,
      stdout: "",
      stderr: "not found",
      exitCode: 1,
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
