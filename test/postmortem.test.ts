import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  shouldAutoPostmortem,
  formatPostmortemMarkdown,
  listPostmortems,
  readPostmortem,
  type PostmortemReport,
} from "../src/postmortem.js";
import { createObservationSession } from "../src/observation.js";
import type { Message } from "../src/llm/types.js";

let testObsDir: string;
let testPmDir: string;

beforeEach(async () => {
  const base = path.join(os.tmpdir(), `pm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  testObsDir = path.join(base, "observations");
  testPmDir = path.join(base, "postmortems");
  await fs.mkdir(testObsDir, { recursive: true });
  await fs.mkdir(testPmDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(path.dirname(testObsDir), { recursive: true, force: true });
});

describe("shouldAutoPostmortem", () => {
  it("returns false for short sessions (< 6 messages)", () => {
    const session = createObservationSession("s1");
    const messages: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(shouldAutoPostmortem(session, messages)).toBe(false);
  });

  it("returns true when toolErrors >= 3", () => {
    const session = createObservationSession("s1");
    session.stats.toolErrors = 3;
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    })) as Message[];
    expect(shouldAutoPostmortem(session, messages)).toBe(true);
  });

  it("returns true when blockers >= 2", () => {
    const session = createObservationSession("s1");
    session.stats.blockers = 2;
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    })) as Message[];
    expect(shouldAutoPostmortem(session, messages)).toBe(true);
  });

  it("returns false when nothing notable happened", () => {
    const session = createObservationSession("s1");
    session.stats.toolCalls = 5;
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    })) as Message[];
    expect(shouldAutoPostmortem(session, messages)).toBe(false);
  });

  it("returns true for sessions > 60 minutes", () => {
    const session = createObservationSession("s1");
    session.startedAt = Date.now() - 61 * 60 * 1000;
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    })) as Message[];
    expect(shouldAutoPostmortem(session, messages)).toBe(true);
  });

  it("returns true when plan steps are abandoned", () => {
    const session = createObservationSession("s1");
    const messages: Message[] = [
      { role: "user", content: "/plan" },
      { role: "assistant", content: "- [x] Step 1\n- [ ] Step 2\n- [ ] Step 3" },
      ...Array.from({ length: 6 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
      })),
    ] as Message[];
    expect(shouldAutoPostmortem(session, messages)).toBe(true);
  });

  it("returns true when sustained frustration (5+ blockers)", () => {
    const session = createObservationSession("s1");
    session.stats.blockers = 5;
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    })) as Message[];
    expect(shouldAutoPostmortem(session, messages)).toBe(true);
  });
});

describe("formatPostmortemMarkdown", () => {
  it("formats a report into readable markdown", () => {
    const report: PostmortemReport = {
      sessionId: "test-abc",
      date: "2026-04-10",
      duration: 47,
      turnCount: 23,
      summary: "Worked on auth refactor.",
      goals: ["Refactor auth middleware"],
      completed: ["Extracted token handler"],
      blockers: ["Rate limit hit"],
      decisions: ["Chose AES-256-GCM"],
      toolUsage: [{ name: "file_write", count: 12, errorRate: 0.08 }],
      fileChanges: ["src/auth.ts"],
      topicProgression: ["auth", "encryption", "tests"],
      sentimentArc: "focused → frustrated → recovered",
      patterns: ["Detect rate limits earlier"],
      recommendations: ["Continue with encryption tests"],
    };

    const md = formatPostmortemMarkdown(report);
    expect(md).toContain("# Post-Mortem: 2026-04-10");
    expect(md).toContain("**Duration:** 47 min");
    expect(md).toContain("Worked on auth refactor.");
    expect(md).toContain("Refactor auth middleware");
    expect(md).toContain("Rate limit hit");
    expect(md).toContain("file_write");
    expect(md).toContain("Detect rate limits earlier");
  });
});

describe("listPostmortems", () => {
  it("lists saved post-mortem files", async () => {
    await fs.writeFile(path.join(testPmDir, "2026-04-10-abc.md"), "# PM");
    await fs.writeFile(path.join(testPmDir, "2026-04-09-def.md"), "# PM");

    const list = await listPostmortems(testPmDir);
    expect(list).toHaveLength(2);
    expect(list[0]).toContain("2026-04-10");
  });

  it("returns empty array when no post-mortems exist", async () => {
    const list = await listPostmortems(testPmDir);
    expect(list).toEqual([]);
  });
});

describe("readPostmortem", () => {
  it("reads a post-mortem file by name", async () => {
    await fs.writeFile(
      path.join(testPmDir, "2026-04-10-abc.md"),
      "# Post-Mortem: 2026-04-10\nContent here",
    );
    const content = await readPostmortem("2026-04-10-abc", testPmDir);
    expect(content).toContain("Content here");
  });

  it("returns null for nonexistent file", async () => {
    const content = await readPostmortem("nonexistent", testPmDir);
    expect(content).toBeNull();
  });
});

describe("crystallizationCandidates", () => {
  const baseReport: PostmortemReport = {
    sessionId: "test-xyz",
    date: "2026-04-11",
    duration: 65,
    turnCount: 30,
    summary: "Built a Stripe integration.",
    goals: ["Set up webhooks"],
    completed: ["Webhook handler"],
    blockers: [],
    decisions: ["AES-256"],
    toolUsage: [],
    fileChanges: [],
    topicProgression: ["stripe"],
    sentimentArc: "focused",
    patterns: ["Verify webhook signatures early"],
    recommendations: ["Add retries"],
  };

  it("renders crystallization section when candidates present", () => {
    const report: PostmortemReport = {
      ...baseReport,
      crystallizationCandidates: [
        {
          name: "stripe-webhook-setup",
          description: "Setting up Stripe webhooks with signature verification",
          triggers: ["stripe", "webhook", "signature"],
          approach: "Use constructEvent to verify signatures.",
          steps: ["Verify signature", "Parse event type", "Return 200"],
          gotchas: ["Use raw body"],
          confidence: 0.85,
        },
      ],
    };
    const md = formatPostmortemMarkdown(report);
    expect(md).toContain("## Crystallization Candidates");
    expect(md).toContain("stripe-webhook-setup");
    expect(md).toContain("0.85");
  });

  it("omits crystallization section when undefined", () => {
    const md = formatPostmortemMarkdown(baseReport);
    expect(md).not.toContain("Crystallization Candidates");
  });

  it("omits crystallization section when empty array", () => {
    const report: PostmortemReport = {
      ...baseReport,
      crystallizationCandidates: [],
    };
    const md = formatPostmortemMarkdown(report);
    expect(md).not.toContain("Crystallization Candidates");
  });
});
