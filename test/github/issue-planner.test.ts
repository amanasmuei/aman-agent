import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LLMClient } from "../../src/llm/types.js";

// ---------- mock setup (hoisted) ----------

const { mockGhJson, mockDecompose } = vi.hoisted(() => {
  const mockGhJson = vi.fn();
  const mockDecompose = vi.fn();
  return { mockGhJson, mockDecompose };
});

vi.mock("../../src/github/cli.js", () => ({
  ghJson: mockGhJson,
  GhError: class GhError extends Error {
    constructor(
      msg: string,
      public exitCode: number,
      public stderr: string,
    ) {
      super(msg);
      this.name = "GhError";
    }
  },
}));

vi.mock("../../src/orchestrator/decompose.js", () => ({
  decomposeRequirement: mockDecompose,
}));

import {
  fetchIssue,
  formatIssueAsRequirement,
  planFromIssue,
} from "../../src/github/issue-planner.js";

const defaultDAG = {
  id: "orch-1",
  name: "Feature",
  goal: "Build feature",
  nodes: [
    {
      id: "t1",
      name: "Task 1",
      profile: "coder",
      tier: "standard",
      dependencies: [],
    },
  ],
  gates: [],
};

beforeEach(() => {
  mockGhJson.mockReset();
  mockDecompose.mockReset();
  mockDecompose.mockResolvedValue(defaultDAG);
});

// ---------- fetchIssue ----------

describe("fetchIssue()", () => {
  const sampleIssueData = {
    number: 42,
    title: "Add dark mode",
    body: "We need dark mode support",
    state: "OPEN",
    url: "https://github.com/owner/repo/issues/42",
    labels: [{ name: "enhancement" }],
    assignees: [{ login: "alice" }],
    author: { login: "bob" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  };

  it("calls ghJson with correct args", async () => {
    mockGhJson.mockResolvedValue(sampleIssueData);

    await fetchIssue(42);

    expect(mockGhJson).toHaveBeenCalledWith(
      [
        "issue",
        "view",
        "42",
        "--json",
        "number,title,body,state,url,labels,assignees,author,createdAt,updatedAt",
      ],
      { cwd: undefined },
    );
  });

  it("adds --repo flag when repo specified", async () => {
    mockGhJson.mockResolvedValue(sampleIssueData);

    await fetchIssue(42, { repo: "owner/repo" });

    expect(mockGhJson).toHaveBeenCalledWith(
      expect.arrayContaining(["--repo", "owner/repo"]),
      expect.any(Object),
    );
  });

  it("returns parsed GitHubIssue", async () => {
    mockGhJson.mockResolvedValue(sampleIssueData);

    const issue = await fetchIssue(42);

    expect(issue.number).toBe(42);
    expect(issue.title).toBe("Add dark mode");
    expect(issue.labels).toEqual([{ name: "enhancement" }]);
  });
});

// ---------- formatIssueAsRequirement ----------

describe("formatIssueAsRequirement()", () => {
  it("formats title and body", () => {
    const result = formatIssueAsRequirement({
      number: 1,
      title: "My Feature",
      body: "Some description",
      state: "OPEN",
      url: "https://github.com/o/r/issues/1",
      labels: [],
      assignees: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(result).toContain("# My Feature");
    expect(result).toContain("Some description");
  });

  it("skips empty labels and assignees", () => {
    const result = formatIssueAsRequirement({
      number: 1,
      title: "Title",
      body: "Body",
      state: "OPEN",
      url: "https://github.com/o/r/issues/1",
      labels: [],
      assignees: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(result).not.toContain("Labels:");
    expect(result).not.toContain("Assignees:");
  });

  it("includes labels when present", () => {
    const result = formatIssueAsRequirement({
      number: 1,
      title: "Title",
      body: "Body",
      state: "OPEN",
      url: "https://github.com/o/r/issues/1",
      labels: [{ name: "bug" }, { name: "urgent" }],
      assignees: [{ login: "alice" }, { login: "bob" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(result).toContain("Labels: bug, urgent");
    expect(result).toContain("Assignees: alice, bob");
  });
});

// ---------- planFromIssue ----------

describe("planFromIssue()", () => {
  const sampleIssueData = {
    number: 10,
    title: "Build search",
    body: "Full-text search feature",
    state: "OPEN",
    url: "https://github.com/o/r/issues/10",
    labels: [{ name: "feature" }],
    assignees: [],
    author: { login: "carol" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const fakeLLM: LLMClient = {
    chat: vi.fn(),
  };

  it("fetches issue and returns DAG", async () => {
    mockGhJson.mockResolvedValue(sampleIssueData);

    const result = await planFromIssue(10, fakeLLM);

    expect(result.issue.number).toBe(10);
    expect(result.dag.id).toBe("orch-1");
    expect(result.dag.nodes).toHaveLength(1);
  });

  it("passes formatted requirement to decomposer", async () => {
    mockGhJson.mockResolvedValue(sampleIssueData);

    await planFromIssue(10, fakeLLM);

    expect(mockDecompose).toHaveBeenCalledWith(
      expect.stringContaining("# Build search"),
      fakeLLM,
    );
    expect(mockDecompose).toHaveBeenCalledWith(
      expect.stringContaining("Full-text search feature"),
      fakeLLM,
    );
  });
});
