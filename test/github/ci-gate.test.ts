import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------- mock setup ----------
const { mockGhJson } = vi.hoisted(() => {
  const mockGhJson = vi.fn();
  return { mockGhJson };
});

vi.mock("../../src/github/cli.js", () => ({
  ghJson: mockGhJson,
}));

import {
  getLatestRun,
  getCheckStatus,
  isCIPassing,
  waitForCI,
} from "../../src/github/ci-gate.js";

beforeEach(() => {
  mockGhJson.mockReset();
});

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    databaseId: 100,
    name: "CI",
    workflowName: "CI",
    status: "completed",
    conclusion: "success",
    url: "https://github.com/owner/repo/actions/runs/100",
    headBranch: "main",
    event: "push",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:01:00Z",
    ...overrides,
  };
}

// ---------- getLatestRun ----------
describe("getLatestRun()", () => {
  it("returns latest run for branch", async () => {
    const run = makeRun();
    mockGhJson.mockResolvedValue([run]);

    const result = await getLatestRun("main");

    expect(result).toEqual(run);
    expect(mockGhJson).toHaveBeenCalledWith(
      expect.arrayContaining(["run", "list", "--branch", "main", "--limit", "1"]),
      expect.anything(),
    );
  });

  it("returns null when no runs exist", async () => {
    mockGhJson.mockResolvedValue([]);

    const result = await getLatestRun("feature-branch");

    expect(result).toBeNull();
  });

  it("adds --workflow filter when specified", async () => {
    mockGhJson.mockResolvedValue([makeRun()]);

    await getLatestRun("main", { workflow: "ci.yml" });

    expect(mockGhJson).toHaveBeenCalledWith(
      expect.arrayContaining(["--workflow", "ci.yml"]),
      expect.anything(),
    );
  });
});

// ---------- isCIPassing ----------
describe("isCIPassing()", () => {
  it("returns true when run succeeded", async () => {
    mockGhJson.mockResolvedValue([makeRun({ status: "completed", conclusion: "success" })]);

    expect(await isCIPassing("main")).toBe(true);
  });

  it("returns false when run failed", async () => {
    mockGhJson.mockResolvedValue([makeRun({ status: "completed", conclusion: "failure" })]);

    expect(await isCIPassing("main")).toBe(false);
  });

  it("returns false when run still in progress", async () => {
    mockGhJson.mockResolvedValue([makeRun({ status: "in_progress", conclusion: null })]);

    expect(await isCIPassing("main")).toBe(false);
  });

  it("returns false when no runs exist", async () => {
    mockGhJson.mockResolvedValue([]);

    expect(await isCIPassing("main")).toBe(false);
  });
});

// ---------- waitForCI ----------
describe("waitForCI()", () => {
  it("resolves when run completes with success", async () => {
    mockGhJson
      .mockResolvedValueOnce([makeRun({ status: "in_progress", conclusion: null })])
      .mockResolvedValueOnce([makeRun({ status: "completed", conclusion: "success" })]);

    const result = await waitForCI("main", {
      pollIntervalMs: 10,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(true);
    expect(result.run).toBeTruthy();
    expect(result.run!.status).toBe("completed");
    expect(result.run!.conclusion).toBe("success");
  });

  it("resolves with passed=false when run fails", async () => {
    mockGhJson
      .mockResolvedValueOnce([makeRun({ status: "in_progress", conclusion: null })])
      .mockResolvedValueOnce([makeRun({ status: "completed", conclusion: "failure" })]);

    const result = await waitForCI("main", {
      pollIntervalMs: 10,
      timeoutMs: 1000,
    });

    expect(result.passed).toBe(false);
    expect(result.run).toBeTruthy();
    expect(result.run!.conclusion).toBe("failure");
  });

  it("returns false on timeout", async () => {
    // Always return in_progress so it never completes
    mockGhJson.mockResolvedValue([makeRun({ status: "in_progress", conclusion: null })]);

    const result = await waitForCI("main", {
      pollIntervalMs: 10,
      timeoutMs: 100,
    });

    expect(result.passed).toBe(false);
    expect(result.run).toBeNull();
  });
});
