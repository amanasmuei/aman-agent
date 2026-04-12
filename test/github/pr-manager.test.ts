import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------- hoisted mocks ----------
const { mockExecFile, mockGh, mockGhJson } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockGh: vi.fn(),
  mockGhJson: vi.fn(),
}));

// Mock child_process for createBranch (git commands)
vi.mock("node:child_process", () => ({ execFile: mockExecFile }));
vi.mock("node:util", () => ({ promisify: (_fn: unknown) => mockExecFile }));

// Mock cli.ts for gh/ghJson
vi.mock("../../src/github/cli.js", () => ({
  gh: mockGh,
  ghJson: mockGhJson,
  GhError: class extends Error {
    constructor(
      m: string,
      public exitCode: number,
      public stderr: string,
    ) {
      super(m);
    }
  },
}));

import {
  createPR,
  listPRs,
  getPR,
  commentOnPR,
  createBranch,
} from "../../src/github/pr-manager.js";

// ---------- sample PR data ----------
const samplePR = {
  number: 42,
  title: "Add feature X",
  body: "Implements feature X",
  state: "OPEN",
  url: "https://github.com/alice/repo/pull/42",
  headRefName: "feature-x",
  baseRefName: "main",
  isDraft: false,
  mergeable: "UNKNOWN",
  labels: [],
  author: { login: "alice" },
  createdAt: "2026-04-12T00:00:00Z",
  updatedAt: "2026-04-12T00:00:00Z",
};

beforeEach(() => {
  mockGh.mockReset();
  mockGhJson.mockReset();
  mockExecFile.mockReset();
  // Default gh to success
  mockGh.mockResolvedValue({ success: true, stdout: "", stderr: "", exitCode: 0 });
});

// ---------- createPR ----------
describe("createPR()", () => {
  it("builds correct gh args with title, body, head", async () => {
    mockGh.mockResolvedValue({
      success: true,
      stdout: "https://github.com/alice/repo/pull/42\n",
      stderr: "",
      exitCode: 0,
    });
    mockGhJson.mockResolvedValue(samplePR);

    await createPR({ title: "Add feature X", body: "Implements feature X", head: "feature-x" });

    expect(mockGh).toHaveBeenCalledWith(
      expect.arrayContaining(["pr", "create", "--title", "Add feature X", "--body", "Implements feature X", "--head", "feature-x"]),
      undefined,
    );
  });

  it("includes --draft flag when draft=true", async () => {
    mockGh.mockResolvedValue({
      success: true,
      stdout: "https://github.com/alice/repo/pull/42\n",
      stderr: "",
      exitCode: 0,
    });
    mockGhJson.mockResolvedValue(samplePR);

    await createPR({ title: "Draft PR", body: "WIP", head: "feature-x", draft: true });

    const args = mockGh.mock.calls[0][0] as string[];
    expect(args).toContain("--draft");
  });

  it("includes --label flags for each label", async () => {
    mockGh.mockResolvedValue({
      success: true,
      stdout: "https://github.com/alice/repo/pull/42\n",
      stderr: "",
      exitCode: 0,
    });
    mockGhJson.mockResolvedValue(samplePR);

    await createPR({
      title: "Labeled PR",
      body: "Has labels",
      head: "feature-x",
      labels: ["bug", "priority"],
    });

    const args = mockGh.mock.calls[0][0] as string[];
    // Should have --label "bug" --label "priority"
    const labelIndices = args.reduce<number[]>((acc, a, i) => (a === "--label" ? [...acc, i] : acc), []);
    expect(labelIndices).toHaveLength(2);
    expect(args[labelIndices[0] + 1]).toBe("bug");
    expect(args[labelIndices[1] + 1]).toBe("priority");
  });

  it("returns parsed GitHubPR after creation", async () => {
    mockGh.mockResolvedValue({
      success: true,
      stdout: "https://github.com/alice/repo/pull/42\n",
      stderr: "",
      exitCode: 0,
    });
    mockGhJson.mockResolvedValue(samplePR);

    const result = await createPR({ title: "Add feature X", body: "Implements feature X", head: "feature-x" });

    expect(result.number).toBe(42);
    expect(result.title).toBe("Add feature X");
  });
});

// ---------- listPRs ----------
describe("listPRs()", () => {
  it("calls ghJson with correct JSON fields", async () => {
    mockGhJson.mockResolvedValue([samplePR]);

    await listPRs();

    const args = mockGhJson.mock.calls[0][0] as string[];
    expect(args).toContain("pr");
    expect(args).toContain("list");
    expect(args).toContain("--json");
    // Verify it requests the expected fields
    const jsonIdx = args.indexOf("--json");
    const fields = args[jsonIdx + 1];
    expect(fields).toContain("number");
    expect(fields).toContain("title");
    expect(fields).toContain("headRefName");
  });

  it("applies state and limit filters", async () => {
    mockGhJson.mockResolvedValue([]);

    await listPRs({ state: "closed", limit: 5 });

    const args = mockGhJson.mock.calls[0][0] as string[];
    expect(args).toContain("--state");
    expect(args).toContain("closed");
    expect(args).toContain("--limit");
    expect(args).toContain("5");
  });
});

// ---------- getPR ----------
describe("getPR()", () => {
  it("fetches specific PR by number", async () => {
    mockGhJson.mockResolvedValue(samplePR);

    const result = await getPR(42);

    const args = mockGhJson.mock.calls[0][0] as string[];
    expect(args).toContain("pr");
    expect(args).toContain("view");
    expect(args).toContain("42");
    expect(args).toContain("--json");
    expect(result.number).toBe(42);
  });
});

// ---------- commentOnPR ----------
describe("commentOnPR()", () => {
  it("calls gh with correct args", async () => {
    await commentOnPR(42, "LGTM!");

    expect(mockGh).toHaveBeenCalledWith(
      ["pr", "comment", "42", "--body", "LGTM!"],
      undefined,
    );
  });
});

// ---------- createBranch ----------
describe("createBranch()", () => {
  it("calls git checkout -b with branch name", async () => {
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

    await createBranch("feature-y");

    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["checkout", "-b", "feature-y"],
      expect.anything(),
    );
  });

  it("includes base branch when specified", async () => {
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

    await createBranch("feature-y", { baseBranch: "develop" });

    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["checkout", "-b", "feature-y", "develop"],
      expect.anything(),
    );
  });
});
