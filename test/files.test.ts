import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = path.join(os.tmpdir(), `aman-files-test-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "hello.txt"), "Hello, world!");
  fs.writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(60_000));
  fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "sub", "nested.ts"), "export const x = 1;");
});

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

import { readFile, listFiles } from "../src/files.js";

describe("readFile", () => {
  it("reads a text file and returns its content", async () => {
    const result = await readFile(path.join(tmpDir, "hello.txt"));
    expect(result.content).toBe("Hello, world!");
    expect(result.truncated).toBe(false);
    expect(result.size).toBeGreaterThan(0);
  });

  it("truncates files over 50KB and sets truncated=true", async () => {
    const result = await readFile(path.join(tmpDir, "big.txt"));
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(50_000);
  });

  it("throws a user-friendly error for non-existent files", async () => {
    await expect(readFile(path.join(tmpDir, "nope.txt"))).rejects.toThrow("not found");
  });

  it("rejects paths outside home directory (safety guard)", async () => {
    await expect(readFile("/etc/passwd")).rejects.toThrow("outside");
  });

  it("rejects a path that is a prefix sibling of home", async () => {
    const homeParent = path.dirname(os.homedir());
    const sibling = path.join(homeParent, path.basename(os.homedir()) + "-evil", "secret.txt");
    await expect(readFile(sibling)).rejects.toThrow("outside");
  });
});

describe("listFiles", () => {
  it("lists files in a directory with sizes", async () => {
    const result = await listFiles(tmpDir);
    expect(result.entries.length).toBeGreaterThan(0);
    const names = result.entries.map((e) => e.name);
    expect(names).toContain("hello.txt");
  });

  it("lists recursively when recursive=true", async () => {
    const result = await listFiles(tmpDir, { recursive: true });
    const names = result.entries.map((e) => e.name);
    expect(names.some((n) => n.includes("nested.ts"))).toBe(true);
  });

  it("throws for non-existent directory", async () => {
    await expect(listFiles(path.join(tmpDir, "ghost"))).rejects.toThrow("not found");
  });

  it("rejects paths outside home directory", async () => {
    await expect(listFiles("/etc")).rejects.toThrow("outside");
  });

  it("rejects a path that is a prefix sibling of home", async () => {
    const homeParent = path.dirname(os.homedir());
    const sibling = path.join(homeParent, path.basename(os.homedir()) + "-evil");
    await expect(listFiles(sibling)).rejects.toThrow("outside");
  });
});
