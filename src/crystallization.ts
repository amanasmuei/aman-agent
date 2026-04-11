import fs from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";

// ── Types ──

export interface SkillCandidate {
  name: string;
  description: string;
  triggers: string[];
  approach: string;
  steps: string[];
  gotchas: string[];
  confidence: number;
}

export interface CrystallizationResult {
  written: boolean;
  filePath: string;
  skillName: string;
  reason?: string;
  collidesWith?: string;
}

export interface MarkerData {
  source: string;
  date: string;
  confidence: number;
  triggers: string[];
}

export interface CrystallizationLogEntry {
  name: string;
  createdAt: string;
  fromPostmortem: string;
  confidence: number;
  triggers: string[];
}

export interface RejectionLogEntry {
  name: string;
  rejectedAt: string;
  fromPostmortem: string;
  triggers: string[];
}

export interface CollisionResult {
  collides: boolean;
  collidesWith?: string;
  reason?: string;
}

// ── Constants ──

const STOPWORDS = new Set([
  "the", "and", "is", "to", "of", "a", "in", "for", "on", "with",
  "this", "that", "it", "as", "be", "by", "or", "at", "an", "from",
  "code", "fix", "do", "use", "make", "get", "set", "run", "we", "i",
]);

const MAX_REJECTIONS = 100;
const MARKER_RE = /<!--\s*aman-auto\s+([^>]+?)\s*-->/;

// ── sanitizeName ──

export function sanitizeName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (cleaned.length === 0) {
    throw new Error(`Cannot sanitize name: "${input}" produced empty result`);
  }
  return cleaned;
}

// ── validateCandidate ──

export function validateCandidate(raw: unknown): SkillCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;

  if (typeof c.name !== "string" || c.name.trim() === "") return null;
  if (typeof c.description !== "string") return null;
  if (typeof c.approach !== "string") return null;
  if (!Array.isArray(c.triggers) || c.triggers.length === 0) return null;
  if (c.triggers.length > 10) return null;
  if (!Array.isArray(c.steps)) return null;
  if (typeof c.confidence !== "number") return null;
  if (!Number.isFinite(c.confidence)) return null;

  if (c.confidence < 0.6) return null;

  const triggers = Array.from(
    new Set(
      c.triggers
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    )
  );

  if (triggers.length === 0) return null;

  let name: string;
  try {
    name = sanitizeName(c.name);
  } catch {
    return null;
  }

  return {
    name,
    description: c.description,
    triggers,
    approach: c.approach,
    steps: c.steps.filter((s): s is string => typeof s === "string"),
    gotchas: Array.isArray(c.gotchas)
      ? c.gotchas.filter((g): g is string => typeof g === "string")
      : [],
    confidence: Math.min(1, Math.max(0, c.confidence)),
  };
}

// ── formatSkillMarkdown ──

function toTitleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatSkillMarkdown(
  candidate: SkillCandidate,
  postmortemFilename: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const heading = toTitleCase(candidate.name);
  const triggerStr = candidate.triggers.join(",");

  const lines: string[] = [
    `# ${heading}`,
    `<!-- aman-auto source=postmortem date=${date} confidence=${candidate.confidence} triggers="${triggerStr}" -->`,
    "",
    "## When to use",
    candidate.approach,
    "",
    "## Steps",
    ...candidate.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
  ];

  if (candidate.gotchas.length > 0) {
    lines.push("## Gotchas");
    lines.push(...candidate.gotchas.map((g) => `- ${g}`));
    lines.push("");
  }

  lines.push(`<!-- generated from ${postmortemFilename} -->`);
  lines.push("");

  return lines.join("\n");
}

// ── parseMarkerComment ──

export function parseMarkerComment(line: string): MarkerData | null {
  const match = line.match(MARKER_RE);
  if (!match) return null;

  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(match[1])) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? "";
  }

  if (!attrs.triggers) return null;

  const triggers = attrs.triggers
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (triggers.length === 0) return null;

  return {
    source: attrs.source ?? "unknown",
    date: attrs.date ?? "",
    confidence: attrs.confidence ? Number(attrs.confidence) : 0,
    triggers,
  };
}

// ── extractSkillsWithMarkers ──

export function extractSkillsWithMarkers(
  skillsMdContent: string,
): Map<string, MarkerData> {
  const result = new Map<string, MarkerData>();
  const lines = skillsMdContent.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ") && i + 1 < lines.length) {
      const headingText = line.slice(2).trim();
      const nextLine = lines[i + 1];
      const marker = parseMarkerComment(nextLine);
      if (marker) {
        try {
          const skillName = sanitizeName(headingText);
          result.set(skillName, marker);
        } catch {
          log.debug("crystallization", `cannot sanitize heading: ${headingText}`);
        }
      }
    }
  }

  return result;
}

// ── findCollision ──

export function findCollision(
  name: string,
  triggers: string[],
  existing: Map<string, MarkerData>,
): CollisionResult {
  if (existing.has(name)) {
    return { collides: true, collidesWith: name, reason: "exact name match" };
  }

  const triggerSet = new Set(triggers);
  for (const [otherName, otherData] of existing) {
    const otherTriggers = new Set(otherData.triggers);
    const intersection = [...triggerSet].filter((t) => otherTriggers.has(t)).length;
    const union = new Set([...triggerSet, ...otherTriggers]).size;
    const overlap = union > 0 ? intersection / union : 0;
    if (overlap >= 0.8) {
      return {
        collides: true,
        collidesWith: otherName,
        reason: `${Math.round(overlap * 100)}% trigger overlap`,
      };
    }
  }

  return { collides: false };
}

// ── writeSkillToFile ──

export async function writeSkillToFile(
  candidate: SkillCandidate,
  skillsMdPath: string,
  postmortemFilename: string,
): Promise<CrystallizationResult> {
  try {
    await fs.mkdir(path.dirname(skillsMdPath), { recursive: true });

    let existingContent = "";
    try {
      existingContent = await fs.readFile(skillsMdPath, "utf-8");
    } catch {
      existingContent = "# Skills\n\n";
    }

    if (existingContent.trim() === "") {
      existingContent = "# Skills\n\n";
    }

    const existingSkills = extractSkillsWithMarkers(existingContent);
    const collision = findCollision(candidate.name, candidate.triggers, existingSkills);
    if (collision.collides) {
      log.debug("crystallization", `collision detected: ${collision.reason}`);
      return {
        written: false,
        filePath: skillsMdPath,
        skillName: candidate.name,
        reason: `collision with "${collision.collidesWith}" (${collision.reason})`,
        collidesWith: collision.collidesWith,
      };
    }

    const skillMarkdown = formatSkillMarkdown(candidate, postmortemFilename);
    const separator = existingContent.endsWith("\n\n")
      ? ""
      : existingContent.endsWith("\n")
      ? "\n"
      : "\n\n";
    await fs.writeFile(
      skillsMdPath,
      existingContent + separator + skillMarkdown,
      "utf-8",
    );

    return {
      written: true,
      filePath: skillsMdPath,
      skillName: candidate.name,
    };
  } catch (err) {
    log.warn("crystallization", "writeSkillToFile failed", err);
    return {
      written: false,
      filePath: skillsMdPath,
      skillName: candidate.name,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── mergeSkillInFile ──

/**
 * Replace an existing skill block in skills.md with a new candidate.
 * Finds the heading for `existingName`, removes everything up to the next heading or EOF,
 * and writes the new candidate in its place.
 */
export async function mergeSkillInFile(
  candidate: SkillCandidate,
  existingName: string,
  skillsMdPath: string,
  postmortemFilename: string,
): Promise<CrystallizationResult> {
  try {
    const content = await fs.readFile(skillsMdPath, "utf-8");
    const lines = content.split("\n");

    // Find the heading line for the existing skill
    const heading = toTitleCase(existingName);
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("# ") && lines[i].slice(2).trim() === heading) {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) {
      return writeSkillToFile(candidate, skillsMdPath, postmortemFilename);
    }

    // Find the end of this skill block (next heading or EOF)
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("# ") && !lines[i].startsWith("## ")) {
        endIdx = i;
        break;
      }
    }

    // Determine version number — count existing archived versions
    const versionPattern = new RegExp(`^# ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.v\\d+`);
    let maxVersion = 0;
    for (const line of lines) {
      if (versionPattern.test(line)) {
        const vMatch = line.match(/\.v(\d+)/);
        if (vMatch) maxVersion = Math.max(maxVersion, parseInt(vMatch[1], 10));
      }
    }
    const archiveVersion = maxVersion + 1;

    // Archive the old version by renaming its heading
    const oldBlock = lines.slice(startIdx, endIdx);
    oldBlock[0] = `# ${heading}.v${archiveVersion}`;
    // Add archive marker
    const archiveMarker = `<!-- aman-archived version=${archiveVersion} archived-at=${new Date().toISOString().slice(0, 10)} -->`;
    if (oldBlock.length > 1 && oldBlock[1].includes("aman-auto")) {
      oldBlock.splice(2, 0, archiveMarker);
    } else {
      oldBlock.splice(1, 0, archiveMarker);
    }

    // Write: archived old block + new candidate
    const newSkillMarkdown = formatSkillMarkdown(candidate, postmortemFilename);
    const before = lines.slice(0, startIdx);
    const after = lines.slice(endIdx);
    const merged = [...before, ...oldBlock, "", newSkillMarkdown, ...after].join("\n");

    await fs.writeFile(skillsMdPath, merged, "utf-8");

    return {
      written: true,
      filePath: skillsMdPath,
      skillName: candidate.name,
      reason: `merged with "${existingName}" (archived as .v${archiveVersion})`,
    };
  } catch (err) {
    log.warn("crystallization", "mergeSkillInFile failed", err);
    return {
      written: false,
      filePath: skillsMdPath,
      skillName: candidate.name,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Logs ──

export async function appendCrystallizationLog(
  entry: CrystallizationLogEntry,
  logPath: string,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    let existing: CrystallizationLogEntry[] = [];
    try {
      const content = await fs.readFile(logPath, "utf-8");
      existing = JSON.parse(content);
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
    existing.push(entry);
    await fs.writeFile(logPath, JSON.stringify(existing, null, 2), "utf-8");
  } catch (err) {
    log.debug("crystallization", "appendCrystallizationLog failed", err);
  }
}

export async function appendRejection(
  candidate: SkillCandidate,
  postmortemFilename: string,
  rejectionsPath: string,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(rejectionsPath), { recursive: true });
    let existing: RejectionLogEntry[] = [];
    try {
      const content = await fs.readFile(rejectionsPath, "utf-8");
      existing = JSON.parse(content);
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }

    existing.push({
      name: candidate.name,
      rejectedAt: new Date().toISOString(),
      fromPostmortem: postmortemFilename,
      triggers: candidate.triggers,
    });

    while (existing.length > MAX_REJECTIONS) {
      existing.shift();
    }

    await fs.writeFile(rejectionsPath, JSON.stringify(existing, null, 2), "utf-8");
  } catch (err) {
    log.debug("crystallization", "appendRejection failed", err);
  }
}

/**
 * Load rejected skill names from the rejections log.
 * Returns unique names. Never throws.
 */
export async function loadRejectedNames(rejectionsPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(rejectionsPath, "utf-8");
    const entries: RejectionLogEntry[] = JSON.parse(content);
    if (!Array.isArray(entries)) return [];
    return [...new Set(entries.map((e) => e.name))];
  } catch {
    return [];
  }
}

// ── Suggestion tracking (cross-session reinforcement) ──

export interface SuggestionCounts {
  [name: string]: number;
}

/**
 * Load suggestion counts. Never throws.
 */
export async function loadSuggestionCounts(suggestionsPath: string): Promise<SuggestionCounts> {
  try {
    const content = await fs.readFile(suggestionsPath, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as SuggestionCounts;
  } catch {
    return {};
  }
}

/**
 * Increment suggestion count for a candidate name. Returns the new count.
 */
export async function incrementSuggestionCount(
  name: string,
  suggestionsPath: string,
): Promise<number> {
  try {
    await fs.mkdir(path.dirname(suggestionsPath), { recursive: true });
    const counts = await loadSuggestionCounts(suggestionsPath);
    counts[name] = (counts[name] || 0) + 1;
    await fs.writeFile(suggestionsPath, JSON.stringify(counts, null, 2), "utf-8");
    return counts[name];
  } catch (err) {
    log.debug("crystallization", "incrementSuggestionCount failed", err);
    return 0;
  }
}
