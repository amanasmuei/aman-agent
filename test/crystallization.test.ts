import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  sanitizeName,
  validateCandidate,
  formatSkillMarkdown,
  parseMarkerComment,
  extractSkillsWithMarkers,
  findCollision,
  writeSkillToFile,
  mergeSkillInFile,
  appendCrystallizationLog,
  appendRejection,
  loadRejectedNames,
  loadSuggestionCounts,
  incrementSuggestionCount,
  type SkillCandidate,
} from "../src/crystallization.js";

let testDir: string;
let skillsMdPath: string;
let logPath: string;
let rejectionsPath: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `crystal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testDir, { recursive: true });
  skillsMdPath = path.join(testDir, "skills.md");
  logPath = path.join(testDir, "crystallization-log.json");
  rejectionsPath = path.join(testDir, "crystallization-rejections.json");
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

const validCandidate = (overrides: Partial<SkillCandidate> = {}): SkillCandidate => ({
  name: "stripe-webhook-setup",
  description: "Set up a Stripe webhook handler with signature verification",
  triggers: ["stripe", "webhook", "signature", "event", "handler"],
  approach: "When the user wants to set up a Stripe webhook handler with signature verification.",
  steps: ["Verify signature", "Parse event type", "Dispatch to handler", "Return 200"],
  gotchas: ["Webhooks need raw body, not parsed JSON"],
  confidence: 0.85,
  ...overrides,
});

describe("sanitizeName", () => {
  it("converts spaces to dashes and lowercases", () => {
    expect(sanitizeName("Stripe Webhook Setup")).toBe("stripe-webhook-setup");
  });

  it("removes special characters", () => {
    expect(sanitizeName("API/Auth!@#")).toBe("api-auth");
  });

  it("trims and collapses whitespace", () => {
    expect(sanitizeName("  trim   me  ")).toBe("trim-me");
  });

  it("collapses multiple consecutive dashes", () => {
    expect(sanitizeName("foo---bar")).toBe("foo-bar");
  });

  it("throws on empty input after sanitization", () => {
    expect(() => sanitizeName("!@#$")).toThrow();
  });
});

describe("validateCandidate", () => {
  it("accepts a well-formed candidate", () => {
    const result = validateCandidate(validCandidate());
    expect(result).not.toBeNull();
    expect(result?.name).toBe("stripe-webhook-setup");
  });

  it("rejects empty name", () => {
    expect(validateCandidate(validCandidate({ name: "" }))).toBeNull();
  });

  it("rejects empty triggers array", () => {
    expect(validateCandidate(validCandidate({ triggers: [] }))).toBeNull();
  });

  it("rejects > 10 triggers", () => {
    const triggers = Array.from({ length: 11 }, (_, i) => `trigger${i}`);
    expect(validateCandidate(validCandidate({ triggers }))).toBeNull();
  });

  it("filters stopwords from triggers", () => {
    const result = validateCandidate(
      validCandidate({ triggers: ["the", "stripe", "and", "webhook", "is"] }),
    );
    expect(result?.triggers).toEqual(["stripe", "webhook"]);
  });

  it("rejects when filtered triggers list is empty", () => {
    expect(validateCandidate(validCandidate({ triggers: ["the", "and", "is"] }))).toBeNull();
  });

  it("clamps confidence > 1.0 to 1.0", () => {
    const result = validateCandidate(validCandidate({ confidence: 1.5 }));
    expect(result?.confidence).toBe(1);
  });

  it("rejects confidence < 0.6", () => {
    expect(validateCandidate(validCandidate({ confidence: 0.5 }))).toBeNull();
  });

  it("rejects NaN confidence", () => {
    expect(validateCandidate(validCandidate({ confidence: NaN }))).toBeNull();
  });

  it("rejects Infinity confidence", () => {
    expect(validateCandidate(validCandidate({ confidence: Infinity }))).toBeNull();
  });

  it("deduplicates triggers (case-insensitive)", () => {
    const result = validateCandidate(
      validCandidate({ triggers: ["stripe", "Stripe", "STRIPE", "webhook"] }),
    );
    expect(result?.triggers).toEqual(["stripe", "webhook"]);
  });

  it("rejects null", () => {
    expect(validateCandidate(null)).toBeNull();
  });

  it("rejects a primitive", () => {
    expect(validateCandidate("not an object")).toBeNull();
  });

  it("rejects an array", () => {
    expect(validateCandidate([1, 2, 3])).toBeNull();
  });

  it("rejects when description is not a string", () => {
    expect(validateCandidate({ ...validCandidate(), description: 42 })).toBeNull();
  });

  it("rejects when approach is not a string", () => {
    expect(validateCandidate({ ...validCandidate(), approach: null })).toBeNull();
  });

  it("rejects when steps is not an array", () => {
    expect(validateCandidate({ ...validCandidate(), steps: "not an array" })).toBeNull();
  });

  it("rejects when confidence is not a number", () => {
    expect(validateCandidate({ ...validCandidate(), confidence: "0.85" })).toBeNull();
  });

  it("defaults gotchas to empty array when missing", () => {
    const candidate = validCandidate();
    delete (candidate as Partial<SkillCandidate>).gotchas;
    const result = validateCandidate(candidate);
    expect(result?.gotchas).toEqual([]);
  });

  it("filters non-string entries from triggers", () => {
    const result = validateCandidate(
      validCandidate({ triggers: ["stripe", 42 as unknown as string, null as unknown as string, "webhook"] }),
    );
    expect(result?.triggers).toEqual(["stripe", "webhook"]);
  });
});

describe("formatSkillMarkdown", () => {
  it("produces marker comment with all required attributes", () => {
    const md = formatSkillMarkdown(validCandidate(), "2026-04-11-a3b2.md");
    expect(md).toContain("<!-- aman-auto");
    expect(md).toContain("source=postmortem");
    expect(md).toContain("confidence=0.85");
    expect(md).toContain('triggers="stripe,webhook,signature,event,handler"');
    expect(md).toMatch(/date=\d{4}-\d{2}-\d{2}/);
  });

  it("includes the heading from the candidate name in title case", () => {
    const md = formatSkillMarkdown(validCandidate(), "2026-04-11-a3b2.md");
    expect(md).toContain("# Stripe Webhook Setup");
  });

  it("renders steps as numbered list and gotchas as bulleted list", () => {
    const md = formatSkillMarkdown(validCandidate(), "2026-04-11-a3b2.md");
    expect(md).toContain("## Steps");
    expect(md).toContain("1. Verify signature");
    expect(md).toContain("## Gotchas");
    expect(md).toContain("- Webhooks need raw body");
  });
});

describe("parseMarkerComment", () => {
  it("extracts triggers from a valid marker", () => {
    const line = '<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.85 triggers="stripe,webhook,signature" -->';
    const parsed = parseMarkerComment(line);
    expect(parsed?.triggers).toEqual(["stripe", "webhook", "signature"]);
    expect(parsed?.source).toBe("postmortem");
    expect(parsed?.date).toBe("2026-04-11");
    expect(parsed?.confidence).toBe(0.85);
  });

  it("returns null for a line with no marker", () => {
    expect(parseMarkerComment("# Just a heading")).toBeNull();
  });

  it("returns null for a malformed marker (missing closing -->)", () => {
    expect(parseMarkerComment('<!-- aman-auto triggers="foo"')).toBeNull();
  });
});

describe("extractSkillsWithMarkers", () => {
  it("returns a map of skill names to marker data", () => {
    const md = `# Skills

# Built-in Skill
## Approach
Just a regular skill with no marker.

# Stripe Webhook Setup
<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.85 triggers="stripe,webhook" -->
## When to use
...
`;
    const result = extractSkillsWithMarkers(md);
    expect(result.size).toBe(1);
    expect(result.has("stripe-webhook-setup")).toBe(true);
    expect(result.get("stripe-webhook-setup")?.triggers).toEqual(["stripe", "webhook"]);
  });

  it("returns empty map when no markers exist", () => {
    const md = "# Skills\n\n# Built-in Skill\nContent.";
    expect(extractSkillsWithMarkers(md).size).toBe(0);
  });

  it("returns multiple skills when multiple markers present", () => {
    const md = `# Skills

# First Skill
<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.85 triggers="alpha,beta" -->
## When to use
First.

# Second Skill
<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.9 triggers="gamma,delta" -->
## When to use
Second.
`;
    const result = extractSkillsWithMarkers(md);
    expect(result.size).toBe(2);
    expect(result.get("first-skill")?.triggers).toEqual(["alpha", "beta"]);
    expect(result.get("second-skill")?.triggers).toEqual(["gamma", "delta"]);
  });

  it("ignores marker that is not on the line immediately after the heading", () => {
    // The contract: marker MUST be on line N+1 where N is the heading line
    const md = `# Skills

# Loose Skill

<!-- aman-auto source=postmortem date=2026-04-11 confidence=0.85 triggers="alpha" -->
## When to use
This skill has a blank line between heading and marker, so it's skipped.
`;
    const result = extractSkillsWithMarkers(md);
    expect(result.size).toBe(0);
  });
});

describe("findCollision", () => {
  it("returns existing skill name on exact name match", () => {
    const existing = new Map([["stripe-webhook-setup", { triggers: ["stripe"], source: "postmortem", date: "2026-04-10", confidence: 0.9 }]]);
    const result = findCollision("stripe-webhook-setup", ["stripe", "webhook"], existing);
    expect(result.collides).toBe(true);
  });

  it("returns no collision for unique name and triggers", () => {
    const existing = new Map([["other-skill", { triggers: ["foo", "bar"], source: "postmortem", date: "2026-04-10", confidence: 0.9 }]]);
    const result = findCollision("stripe-webhook-setup", ["stripe", "webhook"], existing);
    expect(result.collides).toBe(false);
  });

  it("detects > 80% trigger overlap as a collision", () => {
    const existing = new Map([
      ["other-name", { triggers: ["stripe", "webhook", "signature", "event", "handler"], source: "postmortem", date: "2026-04-10", confidence: 0.9 }],
    ]);
    const result = findCollision("different-name", ["stripe", "webhook", "signature", "event"], existing);
    expect(result.collides).toBe(true);
    expect(result.collidesWith).toBe("other-name");
  });

  it("returns no collision when overlap is below 0.8", () => {
    const existing = new Map([
      ["other", { triggers: ["stripe", "webhook", "signature", "event", "handler"], source: "postmortem", date: "2026-04-10", confidence: 0.9 }],
    ]);
    // 3 of 5 shared = intersection 3, union 6 → 0.5 overlap (we add 1 unique to "different")
    const result = findCollision("different", ["stripe", "webhook", "signature", "unique"], existing);
    expect(result.collides).toBe(false);
  });

  it("checks all existing skills for collision", () => {
    const existing = new Map([
      ["first", { triggers: ["foo", "bar"], source: "postmortem", date: "2026-04-10", confidence: 0.9 }],
      ["second", { triggers: ["stripe", "webhook", "signature", "event", "handler"], source: "postmortem", date: "2026-04-10", confidence: 0.9 }],
    ]);
    const result = findCollision("new-name", ["stripe", "webhook", "signature", "event"], existing);
    expect(result.collides).toBe(true);
    expect(result.collidesWith).toBe("second");
  });
});

describe("writeSkillToFile", () => {
  it("creates the file with header if missing", async () => {
    const result = await writeSkillToFile(validCandidate(), skillsMdPath, "2026-04-11-a3b2.md");
    expect(result.written).toBe(true);
    const content = await fs.readFile(skillsMdPath, "utf-8");
    expect(content).toContain("# Skills");
    expect(content).toContain("# Stripe Webhook Setup");
    expect(content).toContain("aman-auto");
  });

  it("appends to an existing file", async () => {
    await fs.writeFile(skillsMdPath, "# Skills\n\n# Existing Skill\nContent.\n", "utf-8");
    const result = await writeSkillToFile(validCandidate(), skillsMdPath, "2026-04-11-a3b2.md");
    expect(result.written).toBe(true);
    const content = await fs.readFile(skillsMdPath, "utf-8");
    expect(content).toContain("# Existing Skill");
    expect(content).toContain("# Stripe Webhook Setup");
  });

  it("returns written=false when collision detected", async () => {
    await writeSkillToFile(validCandidate(), skillsMdPath, "2026-04-11-a3b2.md");
    const result = await writeSkillToFile(validCandidate(), skillsMdPath, "2026-04-11-other.md");
    expect(result.written).toBe(false);
    expect(result.reason).toContain("collision");
  });

  it("treats an empty existing file as a fresh file with header", async () => {
    // Pre-create an empty skills.md (simulating `touch`)
    await fs.writeFile(skillsMdPath, "", "utf-8");

    const result = await writeSkillToFile(validCandidate(), skillsMdPath, "2026-04-11-a3b2.md");
    expect(result.written).toBe(true);

    const content = await fs.readFile(skillsMdPath, "utf-8");
    expect(content.startsWith("# Skills")).toBe(true);
    expect(content).toContain("# Stripe Webhook Setup");
    // Should not start with leading blank lines
    expect(content).not.toMatch(/^\n/);
  });
});

describe("appendCrystallizationLog", () => {
  it("creates log file with first entry", async () => {
    await appendCrystallizationLog(
      {
        name: "stripe-webhook-setup",
        createdAt: "2026-04-11T12:00:00Z",
        fromPostmortem: "2026-04-11-a3b2.md",
        confidence: 0.85,
        triggers: ["stripe", "webhook"],
      },
      logPath,
    );
    const content = JSON.parse(await fs.readFile(logPath, "utf-8"));
    expect(content).toHaveLength(1);
    expect(content[0].name).toBe("stripe-webhook-setup");
  });

  it("appends to existing log", async () => {
    await fs.writeFile(logPath, JSON.stringify([{ name: "old", createdAt: "2026-04-10T00:00:00Z", fromPostmortem: "old.md", confidence: 0.9, triggers: ["a"] }]), "utf-8");
    await appendCrystallizationLog(
      {
        name: "new",
        createdAt: "2026-04-11T12:00:00Z",
        fromPostmortem: "2026-04-11-a3b2.md",
        confidence: 0.85,
        triggers: ["b"],
      },
      logPath,
    );
    const content = JSON.parse(await fs.readFile(logPath, "utf-8"));
    expect(content).toHaveLength(2);
  });
});

describe("appendRejection", () => {
  it("appends a rejection entry and caps at 100", async () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({
      name: `old-${i}`,
      rejectedAt: "2026-04-10T00:00:00Z",
      fromPostmortem: "old.md",
      triggers: ["a"],
    }));
    await fs.writeFile(rejectionsPath, JSON.stringify(existing), "utf-8");

    await appendRejection(validCandidate({ name: "new-rejection" }), "2026-04-11-a3b2.md", rejectionsPath);

    const content = JSON.parse(await fs.readFile(rejectionsPath, "utf-8"));
    expect(content).toHaveLength(100);
    expect(content[content.length - 1].name).toBe("new-rejection");
    expect(content[0].name).toBe("old-1");
  });
});

describe("loadRejectedNames", () => {
  it("returns unique names from rejections file", async () => {
    const entries = [
      { name: "skill-a", rejectedAt: "2026-04-10T00:00:00Z", fromPostmortem: "a.md", triggers: ["x"] },
      { name: "skill-b", rejectedAt: "2026-04-10T00:00:00Z", fromPostmortem: "b.md", triggers: ["y"] },
      { name: "skill-a", rejectedAt: "2026-04-11T00:00:00Z", fromPostmortem: "c.md", triggers: ["x"] },
    ];
    await fs.writeFile(rejectionsPath, JSON.stringify(entries), "utf-8");

    const names = await loadRejectedNames(rejectionsPath);
    expect(names).toEqual(["skill-a", "skill-b"]);
  });

  it("returns empty array when file doesn't exist", async () => {
    const names = await loadRejectedNames(path.join(testDir, "nope.json"));
    expect(names).toEqual([]);
  });
});

describe("suggestion tracking (cross-session reinforcement)", () => {
  it("increments suggestion count and persists", async () => {
    const sugPath = path.join(testDir, "suggestions.json");
    const count1 = await incrementSuggestionCount("my-skill", sugPath);
    expect(count1).toBe(1);

    const count2 = await incrementSuggestionCount("my-skill", sugPath);
    expect(count2).toBe(2);

    const count3 = await incrementSuggestionCount("other-skill", sugPath);
    expect(count3).toBe(1);

    const counts = await loadSuggestionCounts(sugPath);
    expect(counts["my-skill"]).toBe(2);
    expect(counts["other-skill"]).toBe(1);
  });

  it("returns empty object when file doesn't exist", async () => {
    const counts = await loadSuggestionCounts(path.join(testDir, "nope.json"));
    expect(counts).toEqual({});
  });
});

describe("mergeSkillInFile", () => {
  it("archives existing skill with .v1 suffix and writes new version", async () => {
    const original = validCandidate({ name: "deploy-helper", triggers: ["deploy", "ci"] });
    await writeSkillToFile(original, skillsMdPath, "pm-old.md");

    const updated = validCandidate({
      name: "deploy-helper",
      triggers: ["deploy", "ci", "pipeline"],
      approach: "Updated deploy helper approach",
    });
    const result = await mergeSkillInFile(updated, "deploy-helper", skillsMdPath, "pm-new.md");

    expect(result.written).toBe(true);
    expect(result.reason).toContain("archived as .v1");

    const content = await fs.readFile(skillsMdPath, "utf-8");
    expect(content).toContain("Updated deploy helper approach");
    // Old version should be archived
    expect(content).toContain("# Deploy Helper.v1");
    expect(content).toContain("aman-archived");
    // New version should exist
    expect(content).toContain("# Deploy Helper\n");
  });

  it("increments version number on subsequent merges", async () => {
    const original = validCandidate({ name: "deploy-helper", triggers: ["deploy"] });
    await writeSkillToFile(original, skillsMdPath, "pm-1.md");

    // First merge → .v1
    const v2 = validCandidate({ name: "deploy-helper", triggers: ["deploy", "ci"], approach: "v2 approach" });
    await mergeSkillInFile(v2, "deploy-helper", skillsMdPath, "pm-2.md");

    // Second merge → .v2
    const v3 = validCandidate({ name: "deploy-helper", triggers: ["deploy", "ci", "pipeline"], approach: "v3 approach" });
    const result = await mergeSkillInFile(v3, "deploy-helper", skillsMdPath, "pm-3.md");

    expect(result.reason).toContain("archived as .v2");
    const content = await fs.readFile(skillsMdPath, "utf-8");
    expect(content).toContain("# Deploy Helper.v1");
    expect(content).toContain("# Deploy Helper.v2");
    expect(content).toContain("v3 approach");
  });

  it("falls back to append if existing skill not found", async () => {
    await fs.writeFile(skillsMdPath, "# Skills\n\n", "utf-8");
    const candidate = validCandidate({ name: "new-skill", triggers: ["test"] });
    const result = await mergeSkillInFile(candidate, "nonexistent-skill", skillsMdPath, "pm.md");
    expect(result.written).toBe(true);
    const content = await fs.readFile(skillsMdPath, "utf-8");
    expect(content).toContain("New Skill");
  });
});

describe("round-trip: write → extract", () => {
  it("a skill written via writeSkillToFile is parseable via extractSkillsWithMarkers with identical triggers", async () => {
    const candidate = validCandidate({
      name: "round-trip-test",
      triggers: ["alpha", "beta", "gamma"],
    });

    await writeSkillToFile(candidate, skillsMdPath, "2026-04-11-test.md");

    const content = await fs.readFile(skillsMdPath, "utf-8");
    const parsed = extractSkillsWithMarkers(content);

    expect(parsed.size).toBe(1);
    expect(parsed.has("round-trip-test")).toBe(true);
    expect(parsed.get("round-trip-test")?.triggers).toEqual(["alpha", "beta", "gamma"]);
  });
});
