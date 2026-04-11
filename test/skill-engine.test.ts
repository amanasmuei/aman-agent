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

// v0.28 — Semantic trigger matching
import { tokenize, semanticSimilarity, matchSkillsSemantic } from "../src/skill-engine.js";

describe("tokenize", () => {
  it("lowercases and removes stopwords", () => {
    const tokens = tokenize("How do I set up a PostgreSQL database with Prisma?");
    expect(tokens).toContain("postgresql");
    expect(tokens).toContain("database");
    expect(tokens).toContain("prisma");
    expect(tokens).not.toContain("how");
    expect(tokens).not.toContain("do");
    expect(tokens).not.toContain("i");
  });

  it("returns empty for all-stopword input", () => {
    expect(tokenize("I am the")).toEqual([]);
  });
});

describe("semanticSimilarity", () => {
  it("returns high similarity for related terms", () => {
    const sim = semanticSimilarity(
      "I need to write unit tests with vitest and mocking",
      ["test", "spec", "coverage", "tdd", "jest", "vitest", "mocha", "assert", "mock"],
    );
    expect(sim).toBeGreaterThan(0.1);
  });

  it("returns 0 for completely unrelated terms", () => {
    const sim = semanticSimilarity(
      "what is the weather today",
      ["database", "schema", "migration", "index", "query", "sql"],
    );
    expect(sim).toBe(0);
  });
});

describe("matchSkillsSemantic", () => {
  it("includes exact keyword matches", () => {
    const matched = matchSkillsSemantic("I need to debug this error", ["debugging"]);
    expect(matched).toContain("debugging");
  });

  it("can match semantically even without exact keyword", () => {
    // "performance optimization bottleneck" shares terms with performance triggers
    const matched = matchSkillsSemantic(
      "my app has a performance bottleneck and needs optimization",
      ["performance"],
    );
    expect(matched).toContain("performance");
  });
});
