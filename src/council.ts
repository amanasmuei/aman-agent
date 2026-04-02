import pc from "picocolors";
import type { LLMClient } from "./llm/types.js";
import type { McpManager } from "./mcp/client.js";
import { delegateTask, delegateParallel } from "./delegate.js";

// --- Council Advisor Definitions ---

interface Advisor {
  name: string;
  role: string;
  style: string;
}

const ADVISORS: Advisor[] = [
  {
    name: "contrarian",
    role: "The Contrarian",
    style:
      "Search actively for fatal flaws. Assume the idea will fail. Dig hardest when things look solid. Play the skeptic.",
  },
  {
    name: "first-principles",
    role: "The First Principles Thinker",
    style:
      "Strip surface-level framing. Ask what are we actually solving? Challenge the question itself, not just the answer.",
  },
  {
    name: "expansionist",
    role: "The Expansionist",
    style:
      "Hunt for hidden upside and adjacent opportunities. Focus on what happens if this succeeds beyond expectations.",
  },
  {
    name: "outsider",
    role: "The Outsider",
    style:
      "View purely what is presented, zero assumed context about the field. Catch curse-of-knowledge blind spots.",
  },
  {
    name: "executor",
    role: "The Executor",
    style:
      "Answer one question: can this actually get done? Demand Monday-morning clarity on the first concrete step.",
  },
];

export interface CouncilResult {
  question: string;
  advisors: Record<string, string>;
  peerReviews: Record<string, string>;
  verdict: string;
}

// Fisher-Yates shuffle returning letter labels for anonymization
function anonymizeOrder(count: number): string[] {
  const letters = ["A", "B", "C", "D", "E"].slice(0, count);
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
}

/**
 * Run the LLM Council decision-making framework.
 *
 * Step 1 — Advisors respond in parallel (5 independent perspectives)
 * Step 2 — Peer review in parallel (each advisor reviews anonymized responses)
 * Step 3 — Chairman synthesizes into a structured verdict
 */
export async function runCouncil(
  question: string,
  client: LLMClient,
  mcpManager: McpManager,
): Promise<CouncilResult> {
  // Step 1: Convene all 5 advisors in parallel
  const advisorTasks = ADVISORS.map((advisor) => ({
    profile: "default",
    task: `You are ${advisor.role} in a decision-making council.
Your thinking style: ${advisor.style}

The question before the council is:
${question}

Respond independently. Do not hedge. Lean fully into your assigned angle.
150-300 words. No preamble — start directly with your perspective.`,
  }));

  const advisorResults = await delegateParallel(advisorTasks, client, mcpManager, { silent: true });

  const advisorResponses: Record<string, string> = {};
  for (let i = 0; i < ADVISORS.length; i++) {
    advisorResponses[ADVISORS[i].name] = advisorResults[i].success
      ? advisorResults[i].response
      : `[${ADVISORS[i].role} unavailable]`;
  }

  // Step 2: Peer review — anonymize responses, all reviewers run in parallel
  const letters = anonymizeOrder(ADVISORS.length);
  const anonymized = ADVISORS.map((advisor, i) =>
    `Response ${letters[i]}:\n${advisorResponses[advisor.name]}`,
  ).join("\n\n---\n\n");

  const reviewTasks = ADVISORS.map((advisor) => ({
    profile: "default",
    task: `You are ${advisor.role} reviewing 5 anonymous council perspectives on this question:

${question}

The 5 responses (anonymized A–E):

${anonymized}

Answer these 3 questions concisely:
1. Which response is strongest? Why?
2. Which has the biggest blind spot?
3. What did ALL responses miss?

~200 words. Be direct.`,
  }));

  const reviewResults = await delegateParallel(reviewTasks, client, mcpManager, { silent: true });

  const peerReviews: Record<string, string> = {};
  for (let i = 0; i < ADVISORS.length; i++) {
    peerReviews[ADVISORS[i].name] = reviewResults[i].success
      ? reviewResults[i].response
      : "[Review unavailable]";
  }

  // Step 3: Chairman synthesis
  const advisorSummary = ADVISORS.map(
    (a) => `### ${a.role}\n${advisorResponses[a.name]}`,
  ).join("\n\n");

  const reviewSummary = ADVISORS.map(
    (a) => `### ${a.role}'s Peer Review\n${peerReviews[a.name]}`,
  ).join("\n\n");

  const verdictResult = await delegateTask(
    `You are the Chairman of the Council. Synthesize diverse advisor perspectives into a clear verdict.

THE QUESTION:
${question}

ADVISOR PERSPECTIVES:
${advisorSummary}

PEER REVIEWS:
${reviewSummary}

Produce a structured verdict with these exact sections:

**Where the Council Agrees** — converged points (high-confidence signals)
**Where the Council Clashes** — genuine disagreements with both sides explained
**Blind Spots the Council Caught** — insights surfaced only in peer review
**The Recommendation** — clear, actionable answer (not "it depends")
**The One Thing to Do First** — single concrete next step

Be direct. The user needs a decision, not a list of considerations.`,
    "default",
    client,
    mcpManager,
    { silent: true },
  );

  return {
    question,
    advisors: advisorResponses,
    peerReviews,
    verdict: verdictResult.success ? verdictResult.response : "[Chairman synthesis failed]",
  };
}

/**
 * Format a CouncilResult for terminal display.
 */
export function formatCouncilReport(result: CouncilResult): string {
  const lines: string[] = [];

  lines.push(pc.bold(pc.cyan("\n╔══════════════════════════════════════╗")));
  lines.push(pc.bold(pc.cyan("║          LLM COUNCIL SESSION         ║")));
  lines.push(pc.bold(pc.cyan("╚══════════════════════════════════════╝\n")));

  lines.push(`${pc.bold("Question:")} ${result.question}\n`);

  lines.push(pc.bold(pc.yellow("━━━ ADVISOR PERSPECTIVES ━━━")));
  for (const advisor of ADVISORS) {
    lines.push(`\n${pc.bold(pc.white(advisor.role))}`);
    lines.push(result.advisors[advisor.name] ?? "[No response]");
  }

  lines.push(pc.bold(pc.yellow("\n━━━ CHAIRMAN'S VERDICT ━━━\n")));
  lines.push(result.verdict);

  lines.push(pc.dim("\n── End of Council Session ──\n"));

  return lines.join("\n");
}

/**
 * Detect if user input should trigger the council.
 * Returns the extracted question or null if no trigger found.
 */
export function detectCouncilTrigger(input: string): string | null {
  const triggers = [
    "council this",
    "run the council",
    "war room this",
    "pressure-test this",
    "stress-test this",
    "debate this",
  ];

  const lower = input.toLowerCase();
  for (const trigger of triggers) {
    if (lower.includes(trigger)) {
      // Extract the question — everything after the trigger phrase
      const idx = lower.indexOf(trigger);
      const after = input.slice(idx + trigger.length).replace(/^[:\s]+/, "").trim();
      return after.length > 0 ? after : input.replace(new RegExp(trigger, "i"), "").trim();
    }
  }

  return null;
}
