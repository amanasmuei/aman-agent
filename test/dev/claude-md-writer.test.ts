import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  renderToString,
  writeClaudeMd,
  parseMarker,
  checkStaleness,
  type ProjectContext,
} from "../../src/dev/claude-md-writer.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeContext(overrides?: Partial<ProjectContext>): ProjectContext {
  return {
    stack: {
      projectName: "test-project",
      languages: ["go"],
      frameworks: ["fiber"],
      databases: ["postgresql"],
      infra: ["docker"],
      isMonorepo: false,
      detectedAt: Date.now(),
    },
    conventions: ["Error wrapping: use fmt.Errorf"],
    decisions: ["Chose PostgreSQL over MySQL"],
    corrections: ["Never use log.Fatal in handlers"],
    preferences: ["Prefers structured logging"],
    rules: ["Never commit secrets"],
    metadata: {
      generatedAt: Date.now(),
      mode: "template" as const,
      memoriesUsed: 4,
    },
    ...overrides,
  };
}

describe("renderToString", () => {
  it("renders all sections with marker comment", () => {
    const ctx = makeContext();
    const md = renderToString(ctx);
    expect(md).toContain("# Project: test-project");
    expect(md).toContain("<!-- aman-agent:dev");
    expect(md).toContain("## Stack");
    expect(md).toContain("## Conventions");
    expect(md).toContain("Error wrapping: use fmt.Errorf");
    expect(md).toContain("## Past Decisions");
    expect(md).toContain("## Corrections");
    expect(md).toContain("## Developer Preferences");
    expect(md).toContain("## Rules");
  });

  it("omits empty sections", () => {
    const ctx = makeContext({ decisions: [], corrections: [] });
    const md = renderToString(ctx);
    expect(md).not.toContain("## Past Decisions");
    expect(md).not.toContain("## Corrections");
  });

  it("includes memory count in marker", () => {
    const ctx = makeContext();
    const md = renderToString(ctx);
    expect(md).toContain(`memories=${ctx.metadata.memoriesUsed}`);
  });
});

describe("parseMarker", () => {
  it("parses valid marker", () => {
    const content = `# Project\n<!-- aman-agent:dev generated=2026-04-12T10:00:00.000Z memories=5 mode=template -->\n`;
    const marker = parseMarker(content);
    expect(marker).not.toBeNull();
    expect(marker!.generatedAt).toBeInstanceOf(Date);
    expect(marker!.memories).toBe(5);
    expect(marker!.mode).toBe("template");
  });

  it("returns null for missing marker", () => {
    const marker = parseMarker("# Some other CLAUDE.md\nNo marker here\n");
    expect(marker).toBeNull();
  });
});

describe("writeClaudeMd", () => {
  it("writes CLAUDE.md to project root", () => {
    const ctx = makeContext();
    const result = writeClaudeMd(ctx, tmpDir);
    expect(result.written).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("# Project: test-project");
  });

  it("backs up existing CLAUDE.md without marker", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# My hand-written CLAUDE.md\n");
    const ctx = makeContext();
    const result = writeClaudeMd(ctx, tmpDir);
    expect(result.written).toBe(true);
    expect(result.backedUp).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md.bak"))).toBe(true);
  });

  it("overwrites existing CLAUDE.md with marker (no backup)", () => {
    const old = makeContext({ conventions: ["old convention"] });
    writeClaudeMd(old, tmpDir);
    const updated = makeContext({ conventions: ["new convention"] });
    const result = writeClaudeMd(updated, tmpDir);
    expect(result.written).toBe(true);
    expect(result.backedUp).toBe(false);
    const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("new convention");
    expect(content).not.toContain("old convention");
  });
});

describe("checkStaleness", () => {
  it("returns 'missing' when no CLAUDE.md exists", () => {
    const result = checkStaleness(tmpDir);
    expect(result.status).toBe("missing");
  });

  it("returns 'no-marker' for hand-written CLAUDE.md", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Hand written\n");
    const result = checkStaleness(tmpDir);
    expect(result.status).toBe("no-marker");
  });

  it("returns 'fresh' with recent marker", () => {
    const ctx = makeContext();
    writeClaudeMd(ctx, tmpDir);
    const result = checkStaleness(tmpDir);
    expect(result.status).toBe("fresh");
    expect(result.generatedAt).toBeInstanceOf(Date);
  });
});
