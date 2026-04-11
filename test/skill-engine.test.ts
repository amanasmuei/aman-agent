import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadRuntimeTriggers, matchSkills } from "../src/skill-engine.js";

let testDir: string;
let skillsMdPath: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `skill-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testDir, { recursive: true });
  skillsMdPath = path.join(testDir, "skills.md");
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("loadRuntimeTriggers", () => {
  it("reads skills.md and returns map of crystallized skills", async () => {
    const content = `# Skills

# Stripe Webhook Setup
<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.85 triggers="stripe,webhook,signature" -->
## When to use
Setting up webhooks.

# Built-in Skill
## Approach
Just text, no marker.
`;
    await fs.writeFile(skillsMdPath, content, "utf-8");
    const result = await loadRuntimeTriggers(skillsMdPath);
    expect(result.size).toBe(1);
    expect(result.get("stripe-webhook-setup")).toEqual(["stripe", "webhook", "signature"]);
  });

  it("returns empty map when file is missing", async () => {
    const result = await loadRuntimeTriggers(path.join(testDir, "nonexistent.md"));
    expect(result.size).toBe(0);
  });

  it("skips skills without aman-auto marker", async () => {
    await fs.writeFile(skillsMdPath, "# Skills\n\n# Built-in\nNo marker.\n", "utf-8");
    const result = await loadRuntimeTriggers(skillsMdPath);
    expect(result.size).toBe(0);
  });

  it("handles malformed markers gracefully", async () => {
    const content = `# Skills

# Bad Skill
<!-- aman-auto triggers=

# Good Skill
<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.8 triggers="good,trigger" -->
`;
    await fs.writeFile(skillsMdPath, content, "utf-8");
    const result = await loadRuntimeTriggers(skillsMdPath);
    expect(result.size).toBe(1);
    expect(result.has("good-skill")).toBe(true);
  });
});

describe("matchSkills with runtime triggers", () => {
  it("matches against hardcoded triggers (existing behavior preserved)", () => {
    const matched = matchSkills("how do I write a unit test?", ["testing"], new Map());
    expect(matched).toContain("testing");
  });

  it("matches against runtime triggers when supplied", () => {
    const runtime = new Map([["stripe-webhook-setup", ["stripe", "webhook"]]]);
    const matched = matchSkills("setting up a stripe webhook", ["testing"], runtime);
    expect(matched).toContain("stripe-webhook-setup");
  });

  it("matches both hardcoded and runtime triggers in same input", () => {
    const runtime = new Map([["stripe-webhook-setup", ["stripe", "webhook"]]]);
    const matched = matchSkills("test the stripe webhook handler", ["testing"], runtime);
    expect(matched).toContain("testing");
    expect(matched).toContain("stripe-webhook-setup");
  });

  it("does not double-match the same skill name in both maps", () => {
    // If a runtime skill happens to share a name with a hardcoded skill,
    // matchSkills should only return it once
    const runtime = new Map([["testing", ["custom-test-keyword"]]]);
    const matched = matchSkills("custom-test-keyword and unit test", ["testing"], runtime);
    const testingCount = matched.filter((s) => s === "testing").length;
    expect(testingCount).toBe(1);
  });

  it("works without runtime triggers argument (backwards compatible)", () => {
    // Existing call sites that don't pass the third arg should still work
    const matched = matchSkills("how do I write a unit test?", ["testing"]);
    expect(matched).toContain("testing");
  });
});
