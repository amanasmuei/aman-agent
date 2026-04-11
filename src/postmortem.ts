import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readObservationEvents, type ObservationSession } from "./observation.js";
import type { LLMClient, Message } from "./llm/types.js";
import { log } from "./logger.js";
import type { SkillCandidate } from "./crystallization.js";

// ── Types ──

export interface PostmortemReport {
  sessionId: string;
  date: string;
  duration: number;
  turnCount: number;
  summary: string;
  goals: string[];
  completed: string[];
  blockers: string[];
  decisions: string[];
  toolUsage: { name: string; count: number; errorRate: number }[];
  fileChanges: string[];
  topicProgression: string[];
  sentimentArc: string;
  patterns: string[];
  recommendations: string[];
  crystallizationCandidates?: SkillCandidate[];
}

// ── Default directories ──

export function defaultPostmortemsDir(): string {
  return path.join(os.homedir(), ".acore", "postmortems");
}

function defaultObservationsDir(): string {
  return path.join(os.homedir(), ".acore", "observations");
}

// ── Smart trigger ──

export function shouldAutoPostmortem(
  session: ObservationSession,
  messages: Message[],
): boolean {
  if (messages.length < 6) return false;

  const durationMs = Date.now() - session.startedAt;
  return (
    session.stats.toolErrors >= 3 ||
    session.stats.blockers >= 2 ||
    durationMs > 60 * 60_000 ||
    hasAbandonedPlanSteps(messages) ||
    hasSustainedFrustration(session, 5)
  );
}

function hasAbandonedPlanSteps(messages: Message[]): boolean {
  // Check if any message mentions incomplete plan steps (e.g., /plan output with unchecked items)
  const text = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  const unchecked = (text.match(/- \[ \]/g) ?? []).length;
  const checked = (text.match(/- \[x\]/g) ?? []).length;
  // If there are plan steps and some are unchecked, the plan was abandoned
  return checked > 0 && unchecked > 0 && unchecked >= checked;
}

function hasSustainedFrustration(session: ObservationSession, threshold: number): boolean {
  // Use stats counter — events may have been flushed to disk
  return session.stats.blockers >= threshold;
}

// ── Helper: extract text from message content ──

function messageContentToText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");
}

// ── Report generation ──

const POSTMORTEM_PROMPT = `Analyze this session and generate a structured post-mortem report.
Return ONLY valid JSON matching this schema (no markdown, no explanation):

{
  "summary": "2-3 sentence overview",
  "goals": ["what the user tried to accomplish"],
  "completed": ["what actually got done"],
  "blockers": ["what caused friction"],
  "decisions": ["key choices made with rationale"],
  "sentimentArc": "how mood evolved during session",
  "patterns": ["recurring behaviors worth remembering for future sessions"],
  "recommendations": ["actionable suggestions for next session"],
  "crystallizationCandidates": [
    {
      "name": "lowercase-kebab-name",
      "description": "1-sentence description of when this would be useful",
      "triggers": ["3-8", "trigger", "keywords"],
      "approach": "1-paragraph context: when and why to use this procedure",
      "steps": ["ordered step 1", "ordered step 2"],
      "gotchas": ["common mistake 1"],
      "confidence": 0.0
    }
  ]
}

CRYSTALLIZATION RULES:
- Only suggest 0-2 candidates per session — if nothing qualifies, return an empty array
- Only suggest REUSABLE procedures (not one-off tasks specific to today's work)
- The user must have demonstrated the procedure in this session
- Confidence < 0.6 → don't suggest at all
- Skip vague things like "use library X" — that's not procedural knowledge
- Prefer narrow specific procedures over broad generalizations
- Trigger keywords should be highly specific (avoid generic words like "code", "fix", "the")`;

export async function generatePostmortemReport(
  sessionId: string,
  messages: Message[],
  session: ObservationSession,
  client: LLMClient,
  obsDir?: string,
): Promise<PostmortemReport | null> {
  try {
    const events = await readObservationEvents(sessionId, obsDir ?? defaultObservationsDir());

    // Compute tool usage from events
    const toolMap = new Map<string, { calls: number; errors: number }>();
    const fileChanges: string[] = [];
    const topicProgression: string[] = [];

    for (const event of events) {
      if (event.type === "tool_call") {
        const name = (event.data.tool as string) ?? "unknown";
        const entry = toolMap.get(name) ?? { calls: 0, errors: 0 };
        entry.calls++;
        toolMap.set(name, entry);
      } else if (event.type === "tool_error") {
        const name = (event.data.tool as string) ?? "unknown";
        const entry = toolMap.get(name) ?? { calls: 0, errors: 0 };
        entry.errors++;
        toolMap.set(name, entry);
      } else if (event.type === "file_change") {
        const p = (event.data.path as string) ?? "unknown";
        if (!fileChanges.includes(p)) fileChanges.push(p);
      } else if (event.type === "topic_shift") {
        const topics = (event.data.newTopics as string[]) ?? [];
        topicProgression.push(...topics);
      }
    }

    const toolUsage = [...toolMap.entries()].map(([name, { calls, errors }]) => ({
      name,
      count: calls,
      errorRate: calls > 0 ? Math.round((errors / calls) * 100) / 100 : 0,
    }));

    // Build LLM prompt with capped context
    const recentMessages = messages.slice(-20).map((m) => {
      const text = messageContentToText(m.content);
      return `${m.role}: ${text.slice(0, 200)}`;
    });
    const obsSnapshot = events.slice(-30).map((e) => `[${e.type}] ${e.summary}`);

    const durationMin = Math.round((Date.now() - session.startedAt) / 60_000);

    const prompt = `${POSTMORTEM_PROMPT}

Session ID: ${sessionId}
Duration: ${durationMin} minutes
Turns: ${messages.length}
Tool calls: ${session.stats.toolCalls} (${session.stats.toolErrors} errors)
Blockers: ${session.stats.blockers}
Milestones: ${session.stats.milestones}

Recent messages:
${recentMessages.join("\n")}

Observations:
${obsSnapshot.join("\n")}`;

    const response = await client.chat(
      "You are a session analyst. Output only valid JSON.",
      [{ role: "user", content: prompt }],
      () => {}, // no-op onChunk — postmortem runs silently
    );

    const text = messageContentToText(response.message.content);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.debug("postmortem", "LLM returned non-JSON response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      sessionId,
      date: new Date().toISOString().slice(0, 10),
      duration: durationMin,
      turnCount: messages.length,
      summary: parsed.summary ?? "",
      goals: parsed.goals ?? [],
      completed: parsed.completed ?? [],
      blockers: parsed.blockers ?? [],
      decisions: parsed.decisions ?? [],
      toolUsage,
      fileChanges,
      topicProgression: [...new Set(topicProgression)],
      sentimentArc: parsed.sentimentArc ?? "",
      patterns: parsed.patterns ?? [],
      recommendations: parsed.recommendations ?? [],
      crystallizationCandidates: Array.isArray(parsed.crystallizationCandidates)
        ? parsed.crystallizationCandidates
        : undefined,
    };
  } catch (err) {
    log.debug("postmortem", "Failed to generate post-mortem", err);
    return null;
  }
}

// ── Markdown formatting ──

export function formatPostmortemMarkdown(report: PostmortemReport): string {
  const lines: string[] = [
    `# Post-Mortem: ${report.date}`,
    "",
    `**Session:** ${report.sessionId} | **Duration:** ${report.duration} min | **Turns:** ${report.turnCount}`,
    "",
    "## Summary",
    report.summary,
    "",
  ];

  if (report.goals.length > 0) {
    lines.push("## Goals");
    report.goals.forEach((g) => lines.push(`- ${g}`));
    lines.push("");
  }

  if (report.completed.length > 0) {
    lines.push("## Completed");
    report.completed.forEach((c) => lines.push(`- [x] ${c}`));
    lines.push("");
  }

  if (report.blockers.length > 0) {
    lines.push("## Blockers");
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  if (report.decisions.length > 0) {
    lines.push("## Decisions");
    report.decisions.forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  if (report.toolUsage.length > 0) {
    lines.push("## Tool Usage");
    lines.push("| Tool | Calls | Error Rate |");
    lines.push("|------|-------|------------|");
    report.toolUsage.forEach((t) =>
      lines.push(`| ${t.name} | ${t.count} | ${Math.round(t.errorRate * 100)}% |`),
    );
    lines.push("");
  }

  if (report.fileChanges.length > 0) {
    lines.push("## Files Changed");
    report.fileChanges.forEach((f) => lines.push(`- \`${f}\``));
    lines.push("");
  }

  if (report.topicProgression.length > 0) {
    lines.push(`## Topics`);
    lines.push(report.topicProgression.join(" → "));
    lines.push("");
  }

  if (report.sentimentArc) {
    lines.push("## Sentiment Arc");
    lines.push(report.sentimentArc);
    lines.push("");
  }

  if (report.patterns.length > 0) {
    lines.push("## Patterns");
    report.patterns.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  }

  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    report.recommendations.forEach((r) => lines.push(`- ${r}`));
    lines.push("");
  }

  if (
    report.crystallizationCandidates &&
    report.crystallizationCandidates.length > 0
  ) {
    lines.push("## Crystallization Candidates");
    report.crystallizationCandidates.forEach((c) => {
      lines.push(`- **${c.name}** (confidence ${c.confidence})`);
      lines.push(`  ${c.description}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

// ── Save & read post-mortems ──

export async function savePostmortem(
  report: PostmortemReport,
  dir?: string,
): Promise<string> {
  const pmDir = dir ?? defaultPostmortemsDir();
  await fs.mkdir(pmDir, { recursive: true });

  const shortId = report.sessionId.slice(0, 4);
  const fileName = `${report.date}-${shortId}.md`;
  const filePath = path.join(pmDir, fileName);

  const markdown = formatPostmortemMarkdown(report);
  await fs.writeFile(filePath, markdown, "utf-8");

  // Also write a JSON sidecar for lossless re-parsing
  const jsonPath = filePath.replace(/\.md$/, ".json");
  try {
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  } catch (err) {
    log.debug("postmortem", "JSON sidecar write failed", err);
  }

  return filePath;
}

export async function listPostmortems(dir?: string): Promise<string[]> {
  const pmDir = dir ?? defaultPostmortemsDir();
  try {
    const files = await fs.readdir(pmDir);
    return files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function readPostmortem(
  name: string,
  dir?: string,
): Promise<string | null> {
  const pmDir = dir ?? defaultPostmortemsDir();
  const fileName = name.endsWith(".md") ? name : `${name}.md`;
  try {
    return await fs.readFile(path.join(pmDir, fileName), "utf-8");
  } catch {
    return null;
  }
}

export async function analyzePostmortemRange(
  sinceDays: number,
  client: LLMClient,
  dir?: string,
): Promise<string | null> {
  const pmDir = dir ?? defaultPostmortemsDir();
  try {
    const files = await listPostmortems(pmDir);
    const cutoffDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const recentFiles = files.filter((f) => f >= cutoffDate);
    if (recentFiles.length === 0) return "No post-mortems found in the specified range.";

    const contents: string[] = [];
    for (const f of recentFiles.slice(0, 10)) {
      const content = await readPostmortem(f, pmDir);
      if (content) contents.push(content);
    }

    const response = await client.chat(
      "You are a session analyst. Analyze these post-mortems and identify trends.",
      [
        {
          role: "user",
          content: `Analyze these ${contents.length} post-mortem reports from the last ${sinceDays} days. Identify:
1. Recurring blockers
2. Productivity patterns
3. Tool reliability issues
4. Topic continuity across sessions
5. Actionable recommendations

Reports:
${contents.join("\n\n---\n\n")}`,
        },
      ],
      () => {}, // no-op onChunk
    );

    const text = messageContentToText(response.message.content);
    return text || null;
  } catch (err) {
    log.debug("postmortem", "Failed to analyze range", err);
    return null;
  }
}
