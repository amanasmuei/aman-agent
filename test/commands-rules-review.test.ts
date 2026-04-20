import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseSuggestions, acceptSuggestion, rejectSuggestion, phraseHash } from "../src/commands/rules.js";
import { handleCommand } from "../src/commands.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("parseSuggestions", () => {
  it("parses a well-formed block", () => {
    const input = `
## 2026-04-18 22:01 — don't commit without tests
- Phrase: don't commit without tests
- Occurrences: 3
- First seen: 2026-04-18 20:14
- Category (suggested): workflow
- Status: pending
`.trim();
    const result = parseSuggestions(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      phrase: "don't commit without tests",
      occurrences: 3,
      category: "workflow",
      status: "pending",
      explicit: false,
    });
  });

  it("parses explicit-marker occurrence line", () => {
    const input = `
## 2026-04-20 11:02 — never edit on main
- Phrase: never edit on main
- Occurrences: 1 (explicit marker)
- Category (suggested): git
- Status: pending
`.trim();
    const [entry] = parseSuggestions(input);
    expect(entry.occurrences).toBe(1);
    expect(entry.explicit).toBe(true);
  });

  it("skips malformed blocks without crashing", () => {
    const input = `
## good block
- Phrase: good
- Status: pending

## malformed block without needed fields
- Nothing: here

## another good block
- Phrase: another
- Status: pending
`.trim();
    const result = parseSuggestions(input);
    expect(result.map((r) => r.phrase)).toEqual(["good", "another"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseSuggestions("")).toEqual([]);
  });
});

describe("acceptSuggestion", () => {
  it("mutates Status: to accepted with timestamp", () => {
    const source = `## h\n- Phrase: don't commit\n- Category (suggested): git\n- Status: pending\n`;
    const entry = parseSuggestions(source)[0];
    const updated = acceptSuggestion(source, entry, new Date("2026-04-20T11:30:00Z"));
    expect(updated).toContain("- Status: accepted (2026-04-20");
    expect(updated).not.toContain("- Status: pending");
  });

  it("preserves rest of the source", () => {
    const source = `before\n## h\n- Phrase: p\n- Status: pending\n## other\n- Phrase: q\n- Status: pending\nafter\n`;
    const [entry] = parseSuggestions(source);
    const updated = acceptSuggestion(source, entry, new Date("2026-04-20T11:30:00Z"));
    expect(updated).toContain("before\n");
    expect(updated).toContain("after\n");
    // Second entry's pending status should still be there
    const pendingCount = (updated.match(/- Status: pending/g) ?? []).length;
    expect(pendingCount).toBe(1);
  });

  it("preserves original phrase when edited", () => {
    const source = `## h\n- Phrase: original phrase\n- Category (suggested): git\n- Status: pending\n`;
    const entry = parseSuggestions(source)[0];
    const updated = acceptSuggestion(
      source,
      entry,
      new Date("2026-04-20T11:30:00Z"),
      "edited phrase",
      "release",
    );
    expect(updated).toContain("- Original: original phrase");
    expect(updated).toContain("- Phrase: edited phrase");
    expect(updated).toContain("- Category (used): release");
    expect(updated).toContain("- Status: accepted (");
  });
});

describe("rejectSuggestion", () => {
  it("mutates Status: to rejected with timestamp", () => {
    const source = `## h\n- Phrase: p\n- Status: pending\n`;
    const entry = parseSuggestions(source)[0];
    const updated = rejectSuggestion(source, entry, new Date("2026-04-20T13:50:00Z"));
    expect(updated).toContain("- Status: rejected (2026-04-20");
  });
});

describe("phraseHash", () => {
  it("is stable and 64 hex chars for a phrase", () => {
    const h = phraseHash("don't you love this?");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(phraseHash("don't you love this?")).toBe(h);
  });

  it("normalizes case before hashing", () => {
    expect(phraseHash("DON'T")).toBe(phraseHash("don't"));
  });
});

describe("/rules review integration", () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let scopeDir: string;
  let suggPath: string;
  let rejectedPath: string;

  beforeEach(() => {
    // Isolate HOME so tests don't touch real ~/.arules
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "aman-rules-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    scopeDir = path.join(tempHome, ".arules", "dev", "agent");
    fs.mkdirSync(scopeDir, { recursive: true });
    suggPath = path.join(scopeDir, "suggestions.md");
    rejectedPath = path.join(scopeDir, ".rejected-hashes");
    fs.writeFileSync(suggPath, "");
    fs.writeFileSync(rejectedPath, "");
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("reports 'no pending suggestions' when empty", async () => {
    const result = await handleCommand("/rules review", {});
    expect(result.handled).toBe(true);
    expect(result.output).toMatch(/No pending (rule )?suggestions/i);
  });

  it("--list shows pending entries with index and metadata", async () => {
    fs.writeFileSync(suggPath,
      "## h\n- Phrase: don't commit\n- Occurrences: 3\n- Category (suggested): git\n- Status: pending\n");
    const result = await handleCommand("/rules review --list", {});
    expect(result.output).toContain("don't commit");
    expect(result.output).toMatch(/1 pending/);
  });

  it("/rules reject <n> mutates Status and appends hash", async () => {
    fs.writeFileSync(suggPath,
      "## h\n- Phrase: don't you love this\n- Occurrences: 3\n- Category (suggested): general\n- Status: pending\n");
    const result = await handleCommand("/rules reject 1", {});
    expect(result.handled).toBe(true);
    const updatedSource = fs.readFileSync(suggPath, "utf-8");
    expect(updatedSource).toContain("- Status: rejected (");
    const rejected = fs.readFileSync(rejectedPath, "utf-8");
    expect(rejected).toContain(phraseHash("don't you love this"));
  });

  it("/rules accept <n> with missing entry returns error", async () => {
    const result = await handleCommand("/rules accept 99", {});
    expect(result.handled).toBe(true);
    expect(result.output).toMatch(/no pending suggestion/i);
  });
});
