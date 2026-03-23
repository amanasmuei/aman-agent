import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpHome = path.join(os.tmpdir(), `aman-agent-test-prompt-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const { assembleSystemPrompt } = await import("../src/prompt.js");

describe("assembleSystemPrompt", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty prompt and no layers when no ecosystem files exist", () => {
    const result = assembleSystemPrompt();
    expect(result.prompt).toBe("");
    expect(result.layers).toEqual([]);
  });

  it("loads core.md and reports identity layer", () => {
    const coreDir = path.join(tmpHome, ".acore");
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, "core.md"), "# Identity\nI am a test AI", "utf-8");

    const result = assembleSystemPrompt();
    expect(result.prompt).toContain("# Identity");
    expect(result.prompt).toContain("I am a test AI");
    expect(result.layers).toContain("identity");
  });

  it("loads kit.md and reports tools layer", () => {
    const kitDir = path.join(tmpHome, ".akit");
    fs.mkdirSync(kitDir, { recursive: true });
    fs.writeFileSync(path.join(kitDir, "kit.md"), "# Tools\n- search", "utf-8");

    const result = assembleSystemPrompt();
    expect(result.prompt).toContain("# Tools");
    expect(result.layers).toContain("tools");
  });

  it("loads flow.md and reports workflows layer", () => {
    const flowDir = path.join(tmpHome, ".aflow");
    fs.mkdirSync(flowDir, { recursive: true });
    fs.writeFileSync(path.join(flowDir, "flow.md"), "# Workflows\n- deploy", "utf-8");

    const result = assembleSystemPrompt();
    expect(result.prompt).toContain("# Workflows");
    expect(result.layers).toContain("workflows");
  });

  it("loads rules.md and reports guardrails layer", () => {
    const rulesDir = path.join(tmpHome, ".arules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "rules.md"), "# Rules\n- no harm", "utf-8");

    const result = assembleSystemPrompt();
    expect(result.prompt).toContain("# Rules");
    expect(result.layers).toContain("guardrails");
  });

  it("loads skills.md and reports skills layer", () => {
    const skillsDir = path.join(tmpHome, ".askill");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "skills.md"), "# Skills\n- code review", "utf-8");

    const result = assembleSystemPrompt();
    expect(result.prompt).toContain("# Skills");
    expect(result.layers).toContain("skills");
  });

  it("assembles all ecosystem files separated by ---", () => {
    const files: [string, string, string][] = [
      [".acore", "core.md", "Identity content"],
      [".akit", "kit.md", "Tools content"],
      [".aflow", "flow.md", "Workflows content"],
      [".arules", "rules.md", "Rules content"],
      [".askill", "skills.md", "Skills content"],
    ];

    for (const [dir, file, content] of files) {
      const fullDir = path.join(tmpHome, dir);
      fs.mkdirSync(fullDir, { recursive: true });
      fs.writeFileSync(path.join(fullDir, file), content, "utf-8");
    }

    const result = assembleSystemPrompt();
    // Budget-aware ordering: sorted by priority (identity, guardrails, workflows, tools, skills)
    expect(result.layers).toEqual(["identity", "guardrails", "workflows", "tools", "skills"]);

    // All content pieces present and separated by ---
    for (const [, , content] of files) {
      expect(result.prompt).toContain(content);
    }

    // Verify separator format
    const separatorCount = (result.prompt.match(/\n\n---\n\n/g) || []).length;
    expect(separatorCount).toBe(4); // 5 parts = 4 separators
  });

  it("loads only some files and reports correct layers", () => {
    // Only core.md and rules.md
    const coreDir = path.join(tmpHome, ".acore");
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, "core.md"), "Identity only", "utf-8");

    const rulesDir = path.join(tmpHome, ".arules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "rules.md"), "Rules only", "utf-8");

    const result = assembleSystemPrompt();
    // Budget-aware ordering: identity first, then guardrails
    expect(result.layers).toEqual(["identity", "guardrails"]);
    expect(result.prompt).toContain("Identity only");
    expect(result.prompt).toContain("Rules only");
    expect(result.prompt).not.toContain("Tools");
  });

  it("trims whitespace from file contents", () => {
    const coreDir = path.join(tmpHome, ".acore");
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, "core.md"), "\n  padded content  \n\n", "utf-8");

    const result = assembleSystemPrompt();
    expect(result.prompt).toBe("padded content");
  });
});
