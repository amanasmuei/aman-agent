import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("@aman_asmuei/amem-core", () => ({
  createDatabase: vi.fn(() => ({ close: vi.fn() })),
  recall: vi.fn(async () => ({
    memories: [
      { id: "1", content: "Always use error wrapping", type: "correction", confidence: 0.95 },
      { id: "2", content: "Middleware order: logger then cors then auth", type: "pattern", confidence: 0.9 },
    ],
  })),
}));

vi.mock("@aman_asmuei/acore-core", () => ({
  getIdentity: vi.fn(async () => null),
}));

vi.mock("@aman_asmuei/arules-core", () => ({
  listRuleCategories: vi.fn(async () => [
    { name: "security", rules: ["No secrets in commits"] },
  ]),
}));

import { scanStack } from "../../src/dev/stack-detector.js";
import { buildContext } from "../../src/dev/context-builder.js";
import { renderToString, writeClaudeMd, checkStaleness, parseMarker } from "../../src/dev/claude-md-writer.js";
import { runDev } from "../../src/dev/dev-command.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("aman-agent dev e2e", () => {
  it("full pipeline: scan -> build -> write -> verify", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module github.com/test/amantrade\n\ngo 1.22\n");
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM golang:1.22\n");
    fs.writeFileSync(path.join(tmpDir, "docker-compose.yml"), "services:\n  db:\n    image: postgres:16\n");
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "name: CI\n");

    const stack = scanStack(tmpDir);
    expect(stack.projectName).toBe("amantrade");
    expect(stack.languages).toContain("go");
    expect(stack.databases).toContain("postgresql");

    const ctx = await buildContext(stack);
    expect(ctx.conventions.length).toBeGreaterThan(0);
    expect(ctx.corrections.length).toBeGreaterThan(0);

    const md = renderToString(ctx);
    expect(md).toContain("# Project: amantrade");

    const result = writeClaudeMd(ctx, tmpDir);
    expect(result.written).toBe(true);

    const staleness = checkStaleness(tmpDir);
    expect(staleness.status).toBe("fresh");

    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    const marker = parseMarker(content);
    expect(marker).not.toBeNull();
  });

  it("runDev produces valid output end-to-end", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      name: "my-next-app",
      dependencies: { next: "^14.0.0" },
    }));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");

    const result = await runDev(tmpDir, { noLaunch: true });
    expect(result.success).toBe(true);
    expect(result.generated).toBe(true);

    const md = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(md).toContain("my-next-app");
  });

  it("gitignore is updated when CLAUDE.md is generated", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module test\n\ngo 1.22\n");
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");

    await runDev(tmpDir, { noLaunch: true });

    const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("CLAUDE.md");
  });
});
