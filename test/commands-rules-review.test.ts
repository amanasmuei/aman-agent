import { describe, it, expect } from "vitest";
import { parseSuggestions } from "../src/commands/rules.js";

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
