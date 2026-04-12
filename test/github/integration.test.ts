import { describe, it, expect } from "vitest";
import {
  // Types & schemas
  GitHubIssueSchema,
  GitHubPRSchema,
  WorkflowRunSchema,
  CheckStatusSchema,
  GhResultSchema,
  // CLI
  gh,
  ghJson,
  ghAvailable,
  ghCurrentRepo,
  GhError,
  // Issue planner
  fetchIssue,
  formatIssueAsRequirement,
  planFromIssue,
  // PR manager
  createPR,
  listPRs,
  getPR,
  commentOnPR,
  createBranch,
  // CI gate
  getLatestRun,
  getCheckStatus,
  waitForCI,
  isCIPassing,
} from "../../src/github/index.js";

describe("github module public API", () => {
  it("exports all CLI functions", () => {
    expect(typeof gh).toBe("function");
    expect(typeof ghJson).toBe("function");
    expect(typeof ghAvailable).toBe("function");
    expect(typeof ghCurrentRepo).toBe("function");
    expect(GhError).toBeDefined();
  });

  it("exports all issue planner functions", () => {
    expect(typeof fetchIssue).toBe("function");
    expect(typeof formatIssueAsRequirement).toBe("function");
    expect(typeof planFromIssue).toBe("function");
  });

  it("exports all PR manager functions", () => {
    expect(typeof createPR).toBe("function");
    expect(typeof listPRs).toBe("function");
    expect(typeof getPR).toBe("function");
    expect(typeof commentOnPR).toBe("function");
    expect(typeof createBranch).toBe("function");
  });

  it("exports all CI gate functions", () => {
    expect(typeof getLatestRun).toBe("function");
    expect(typeof getCheckStatus).toBe("function");
    expect(typeof waitForCI).toBe("function");
    expect(typeof isCIPassing).toBe("function");
  });

  it("exports all schemas", () => {
    expect(GitHubIssueSchema).toBeDefined();
    expect(GitHubPRSchema).toBeDefined();
    expect(WorkflowRunSchema).toBeDefined();
    expect(CheckStatusSchema).toBeDefined();
    expect(GhResultSchema).toBeDefined();
  });

  it("formatIssueAsRequirement end-to-end", () => {
    const issue = GitHubIssueSchema.parse({
      number: 42,
      title: "Add user auth",
      body: "Implement JWT authentication",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/42",
      labels: [{ name: "feature" }, { name: "auth" }],
      assignees: [{ login: "alice" }],
      createdAt: "2026-04-12T00:00:00Z",
      updatedAt: "2026-04-12T00:00:00Z",
    });
    const req = formatIssueAsRequirement(issue);
    expect(req).toContain("# Add user auth");
    expect(req).toContain("Implement JWT authentication");
    expect(req).toContain("feature");
    expect(req).toContain("auth");
    expect(req).toContain("alice");
  });

  it("formatIssueAsRequirement handles issue with no body", () => {
    const issue = GitHubIssueSchema.parse({
      number: 1,
      title: "Simple bug",
      body: null,
      state: "OPEN",
      url: "https://github.com/test/repo/issues/1",
      labels: [],
      assignees: [],
      createdAt: "2026-04-12T00:00:00Z",
      updatedAt: "2026-04-12T00:00:00Z",
    });
    const req = formatIssueAsRequirement(issue);
    expect(req).toContain("# Simple bug");
    expect(req).not.toContain("Labels:");
    expect(req).not.toContain("Assignees:");
  });
});
