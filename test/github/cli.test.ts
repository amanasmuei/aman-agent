import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------- mock setup ----------
const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn();
  return { mockExecFile };
});

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:util", () => ({
  promisify: (_fn: unknown) => mockExecFile,
}));

import { gh, ghJson, ghAvailable, ghCurrentRepo, GhError } from "../../src/github/cli.js";

beforeEach(() => {
  mockExecFile.mockReset();
});

// ---------- gh() ----------
describe("gh()", () => {
  it("returns success result with stdout/stderr", async () => {
    mockExecFile.mockResolvedValue({ stdout: "hello\n", stderr: "" });

    const result = await gh(["version"]);

    expect(result).toEqual({
      success: true,
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("returns failure result (non-zero exit) without throwing", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: "not found",
    });
    mockExecFile.mockRejectedValue(err);

    const result = await gh(["pr", "view", "999"]);

    expect(result).toEqual({
      success: false,
      stdout: "",
      stderr: "not found",
      exitCode: 1,
    });
  });

  it("uses execFile with correct args array (no shell)", async () => {
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

    await gh(["pr", "list", "--state", "open"]);

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--state", "open"],
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it("respects GH_PATH env override for binary path", async () => {
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

    await gh(["version"], { env: { GH_PATH: "/usr/local/bin/gh-custom" } });

    // The first arg to execFile should be the custom path
    expect(mockExecFile.mock.calls[0][0]).toBe("/usr/local/bin/gh-custom");
  });

  it("passes cwd and timeout options", async () => {
    mockExecFile.mockResolvedValue({ stdout: "", stderr: "" });

    await gh(["version"], { cwd: "/tmp", timeoutMs: 5_000 });

    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["version"],
      expect.objectContaining({ cwd: "/tmp", timeout: 5_000 }),
    );
  });
});

// ---------- ghJson() ----------
describe("ghJson()", () => {
  it("parses JSON output", async () => {
    mockExecFile.mockResolvedValue({
      stdout: '{"number": 1, "title": "Fix bug"}',
      stderr: "",
    });

    const result = await ghJson<{ number: number; title: string }>(["pr", "view", "1", "--json", "number,title"]);

    expect(result).toEqual({ number: 1, title: "Fix bug" });
  });

  it("throws GhError on command failure", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: "not found",
    });
    mockExecFile.mockRejectedValue(err);

    await expect(ghJson(["pr", "view", "999"])).rejects.toThrow(GhError);
    await expect(ghJson(["pr", "view", "999"])).rejects.toMatchObject({
      exitCode: 1,
      stderr: "not found",
    });
  });

  it("throws on invalid JSON", async () => {
    mockExecFile.mockResolvedValue({
      stdout: "not-json{{{",
      stderr: "",
    });

    await expect(ghJson(["pr", "view", "1"])).rejects.toThrow();
  });
});

// ---------- ghAvailable() ----------
describe("ghAvailable()", () => {
  it("returns true when auth succeeds", async () => {
    mockExecFile.mockResolvedValue({ stdout: "Logged in", stderr: "" });

    expect(await ghAvailable()).toBe(true);
  });

  it("returns false when auth fails", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: "not logged in",
    });
    mockExecFile.mockRejectedValue(err);

    expect(await ghAvailable()).toBe(false);
  });
});

// ---------- ghCurrentRepo() ----------
describe("ghCurrentRepo()", () => {
  it("returns owner/name from gh output", async () => {
    mockExecFile.mockResolvedValue({
      stdout: '{"owner":{"login":"alice"},"name":"my-repo"}',
      stderr: "",
    });

    const repo = await ghCurrentRepo();

    expect(repo).toEqual({ owner: "alice", name: "my-repo" });
  });

  it("returns null when not in a repo", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: "not a git repository",
    });
    mockExecFile.mockRejectedValue(err);

    expect(await ghCurrentRepo()).toBeNull();
  });
});
