import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { McpManager } from "./mcp/client.js";
import { log } from "./logger.js";
import { extractSkillsWithMarkers } from "./crystallization.js";

// --- Skill Keyword Map for Auto-Triggering ---

const SKILL_TRIGGERS: Record<string, string[]> = {
  testing: ["test", "spec", "coverage", "tdd", "jest", "vitest", "mocha", "assert", "mock", "stub", "fixture", "e2e", "integration test", "unit test"],
  "api-design": ["api", "endpoint", "rest", "graphql", "route", "controller", "middleware", "http", "request", "response", "status code", "pagination"],
  security: ["security", "auth", "csrf", "xss", "injection", "cors", "jwt", "token", "oauth", "password", "hash", "encrypt", "vulnerability", "owasp", "sanitize"],
  performance: ["performance", "slow", "latency", "cache", "optimize", "profil", "bundle size", "lazy load", "memory leak", "benchmark", "bottleneck"],
  "code-review": ["review", "pr review", "pull request", "code quality", "clean code", "best practice"],
  documentation: ["document", "readme", "jsdoc", "tsdoc", "changelog", "adr", "comment"],
  "git-workflow": ["git", "branch", "merge", "rebase", "cherry-pick", "bisect", "stash", "commit message", "pr", "pull request"],
  debugging: ["debug", "breakpoint", "stack trace", "error", "exception", "crash", "bug", "issue", "unexpected", "reproduce"],
  refactoring: ["refactor", "extract", "rename", "move", "split", "consolidate", "dry", "code smell", "technical debt", "legacy"],
  database: ["database", "schema", "migration", "index", "query", "sql", "postgres", "mysql", "sqlite", "mongo", "orm", "prisma", "drizzle"],
  typescript: ["typescript", "type", "interface", "generic", "infer", "utility type", "zod", "discriminated union", "type guard", "as const"],
  accessibility: ["accessibility", "a11y", "aria", "screen reader", "wcag", "semantic html", "tab order", "focus", "contrast"],
};

// --- Runtime Triggers (crystallized skills) ---

/**
 * Load runtime trigger keywords from crystallized skills in ~/.askill/skills.md.
 * These supplement the hardcoded SKILL_TRIGGERS map without modifying it.
 *
 * Returns a Map<skillName, triggers[]>. Returns empty map if file is missing or
 * unreadable — never throws.
 */
export async function loadRuntimeTriggers(
  skillsMdPath: string,
): Promise<Map<string, string[]>> {
  try {
    const content = await fsp.readFile(skillsMdPath, "utf-8");
    const skills = extractSkillsWithMarkers(content);
    const result = new Map<string, string[]>();
    for (const [name, marker] of skills) {
      result.set(name, marker.triggers);
    }
    return result;
  } catch (err) {
    log.debug("skill-engine", "loadRuntimeTriggers failed", err);
    return new Map();
  }
}

// --- Skill Level Tracking ---

const LEVEL_FILE = path.join(os.homedir(), ".aman-agent", "skill-levels.json");

interface SkillLevel {
  name: string;
  activations: number;
  lastUsed: string;
  userPatterns: string[];  // user-specific patterns learned
}

function loadSkillLevels(): Record<string, SkillLevel> {
  try {
    if (fs.existsSync(LEVEL_FILE)) {
      return JSON.parse(fs.readFileSync(LEVEL_FILE, "utf-8")) as Record<string, SkillLevel>;
    }
  } catch { /* ignore */ }
  return {};
}

function saveSkillLevels(levels: Record<string, SkillLevel>): void {
  const dir = path.dirname(LEVEL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEVEL_FILE, JSON.stringify(levels, null, 2), "utf-8");
}

/**
 * Compute skill level from activation count.
 * Lv.1 = beginner guidance, Lv.5 = proactive expert suggestions
 */
export function computeLevel(activations: number): { level: number; label: string } {
  if (activations >= 50) return { level: 5, label: "Expert" };
  if (activations >= 25) return { level: 4, label: "Advanced" };
  if (activations >= 10) return { level: 3, label: "Proficient" };
  if (activations >= 3) return { level: 2, label: "Familiar" };
  return { level: 1, label: "Learning" };
}

/**
 * Record a skill activation and return updated level.
 */
export function recordActivation(skillName: string): { level: number; label: string } {
  const levels = loadSkillLevels();
  if (!levels[skillName]) {
    levels[skillName] = { name: skillName, activations: 0, lastUsed: "", userPatterns: [] };
  }
  levels[skillName].activations++;
  levels[skillName].lastUsed = new Date().toISOString().split("T")[0];
  saveSkillLevels(levels);
  return computeLevel(levels[skillName].activations);
}

/**
 * Get current level for a skill.
 */
export function getSkillLevel(skillName: string): { level: number; label: string; activations: number } {
  const levels = loadSkillLevels();
  const data = levels[skillName];
  if (!data) return { level: 1, label: "Learning", activations: 0 };
  const { level, label } = computeLevel(data.activations);
  return { level, label, activations: data.activations };
}

// --- Auto-Triggered Skills ---

/**
 * Match user input against installed skill triggers.
 * Returns skill names that should be activated for this turn.
 */
export function matchSkills(
  userInput: string,
  installedSkillNames: string[],
  runtimeTriggers: Map<string, string[]> = new Map(),
): string[] {
  const input = userInput.toLowerCase();
  const matched = new Set<string>();

  // Hardcoded triggers — only fire for installed skills
  for (const skillName of installedSkillNames) {
    const triggers = SKILL_TRIGGERS[skillName];
    if (!triggers) continue;

    for (const trigger of triggers) {
      if (input.includes(trigger)) {
        matched.add(skillName);
        break;
      }
    }
  }

  // Runtime triggers — fire regardless of installedSkillNames since
  // crystallized skills may not appear in the aman-mcp skill_list
  for (const [skillName, triggers] of runtimeTriggers) {
    for (const trigger of triggers) {
      if (input.includes(trigger)) {
        matched.add(skillName);
        break;
      }
    }
  }

  return Array.from(matched);
}

// --- Semantic Trigger Matching (TF-IDF cosine similarity) ---

const SEMANTIC_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "and",
  "but", "or", "nor", "not", "so", "yet", "both", "either", "neither",
  "each", "every", "all", "any", "few", "more", "most", "other",
  "some", "such", "no", "only", "own", "same", "than", "too", "very",
  "just", "because", "if", "when", "while", "how", "what", "which",
  "who", "whom", "this", "that", "these", "those", "i", "me", "my",
  "we", "us", "our", "you", "your", "he", "him", "his", "she", "her",
  "it", "its", "they", "them", "their",
]);

/**
 * Tokenize text into lowercased words, filtering stopwords and short tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SEMANTIC_STOPWORDS.has(w));
}

/**
 * Build a term frequency map for tokens.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // Normalize by document length
  for (const [k, v] of tf) {
    tf.set(k, v / tokens.length);
  }
  return tf;
}

/**
 * Compute cosine similarity between two term frequency maps.
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [k, v] of a) {
    normA += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const [, v] of b) {
    normB += v * v;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Check if user input semantically matches a set of trigger keywords.
 * Uses TF-IDF-like bag-of-words cosine similarity.
 * @returns similarity score (0-1)
 */
export function semanticSimilarity(userInput: string, triggers: string[]): number {
  const inputTokens = tokenize(userInput);
  if (inputTokens.length === 0) return 0;

  // Build trigger "document" from all trigger keywords
  const triggerTokens = triggers.flatMap((t) => tokenize(t));
  if (triggerTokens.length === 0) return 0;

  const inputTf = termFrequency(inputTokens);
  const triggerTf = termFrequency(triggerTokens);

  return cosineSimilarity(inputTf, triggerTf);
}

const SEMANTIC_THRESHOLD = 0.15;

/**
 * Enhanced matchSkills with semantic similarity fallback.
 */
export function matchSkillsSemantic(
  userInput: string,
  installedSkillNames: string[],
  runtimeTriggers: Map<string, string[]> = new Map(),
): string[] {
  // First, get exact keyword matches
  const exact = matchSkills(userInput, installedSkillNames, runtimeTriggers);
  const matched = new Set(exact);

  // Then, check semantic similarity for skills not already matched
  for (const skillName of installedSkillNames) {
    if (matched.has(skillName)) continue;
    const triggers = SKILL_TRIGGERS[skillName];
    if (!triggers) continue;

    const sim = semanticSimilarity(userInput, triggers);
    if (sim >= SEMANTIC_THRESHOLD) {
      matched.add(skillName);
    }
  }

  for (const [skillName, triggers] of runtimeTriggers) {
    if (matched.has(skillName)) continue;
    const sim = semanticSimilarity(userInput, triggers);
    if (sim >= SEMANTIC_THRESHOLD) {
      matched.add(skillName);
    }
  }

  return Array.from(matched);
}

/**
 * Format skill context block for injection into system prompt.
 * Adapts detail level based on skill level.
 */
export function formatSkillContext(
  skillName: string,
  skillContent: string,
  level: { level: number; label: string },
): string {
  let depthHint: string;
  if (level.level >= 4) {
    depthHint = "User is advanced — skip basics, focus on edge cases and proactive optimization.";
  } else if (level.level >= 3) {
    depthHint = "User is proficient — brief reminders of principles, focus on the specific task.";
  } else if (level.level >= 2) {
    depthHint = "User is familiar — explain reasoning briefly, show patterns.";
  } else {
    depthHint = "User is learning — explain concepts clearly, show examples, be patient.";
  }

  return `<active-skill name="${skillName}" level="${level.level}" label="${level.label}">
${depthHint}

${skillContent}
</active-skill>`;
}

/**
 * Auto-trigger skills based on user input.
 * Reads installed skills, matches keywords, injects context.
 * Returns formatted skill blocks to append to system prompt.
 */
export async function autoTriggerSkills(
  userInput: string,
  mcpManager: McpManager,
): Promise<string> {
  try {
    // Get installed skills
    const result = await mcpManager.callTool("skill_list", {});
    const skills = JSON.parse(result) as Array<{ name: string; description: string; installed: boolean }>;
    const installed = skills.filter((s) => s.installed).map((s) => s.name);

    // Load runtime (crystallized) triggers from ~/.askill/skills.md
    const skillsMdPath = path.join(os.homedir(), ".askill", "skills.md");
    const runtimeTriggers = await loadRuntimeTriggers(skillsMdPath);

    if (installed.length === 0 && runtimeTriggers.size === 0) return "";

    // Match user input against skill triggers (keyword + semantic)
    const matched = matchSkillsSemantic(userInput, installed, runtimeTriggers);
    if (matched.length === 0) return "";

    // Load skill content and build context blocks
    const blocks: string[] = [];
    for (const skillName of matched.slice(0, 2)) { // max 2 skills per turn
      // Record activation and get level
      const level = recordActivation(skillName);

      // Read skill content from skills.md
      const skillsContent = await mcpManager.callTool("skill_search", { query: skillName });
      const skillEntries = JSON.parse(skillsContent) as Array<{ name: string; description: string }>;
      const entry = skillEntries.find((s) => s.name.toLowerCase() === skillName.toLowerCase());

      if (entry) {
        blocks.push(formatSkillContext(skillName, entry.description, level));
      }

      log.debug("skill-engine", `Auto-triggered: ${skillName} (Lv.${level.level} ${level.label})`);
    }

    return blocks.join("\n\n");
  } catch (err) {
    log.debug("skill-engine", "autoTriggerSkills failed", err);
    return "";
  }
}

// --- Self-Improving Skills ---

/**
 * Enrich a skill with a user-specific pattern learned from conversation.
 * Called by memory-extractor when a "pattern" type extraction matches a skill domain.
 */
export function enrichSkill(skillName: string, pattern: string): void {
  const levels = loadSkillLevels();
  if (!levels[skillName]) {
    levels[skillName] = { name: skillName, activations: 0, lastUsed: "", userPatterns: [] };
  }

  // Deduplicate patterns
  const existing = levels[skillName].userPatterns;
  if (existing.length >= 20) return; // cap at 20 patterns per skill
  if (existing.some((p) => p.toLowerCase() === pattern.toLowerCase())) return;

  levels[skillName].userPatterns.push(pattern);
  saveSkillLevels(levels);
  log.debug("skill-engine", `Enriched ${skillName} with pattern: ${pattern.slice(0, 80)}`);
}

/**
 * Get user-specific patterns for a skill (for injection into skill context).
 */
export function getSkillPatterns(skillName: string): string[] {
  const levels = loadSkillLevels();
  return levels[skillName]?.userPatterns || [];
}

/**
 * Match a memory extraction pattern to a skill domain.
 * Returns the skill name if the pattern is relevant, null otherwise.
 */
export function matchPatternToSkill(patternContent: string, tags: string[]): string | null {
  const combined = (patternContent + " " + tags.join(" ")).toLowerCase();

  for (const [skillName, triggers] of Object.entries(SKILL_TRIGGERS)) {
    for (const trigger of triggers) {
      if (combined.includes(trigger)) {
        return skillName;
      }
    }
  }

  return null;
}

// --- Knowledge Library ---

export interface KnowledgeItem {
  name: string;
  category: string;
  description: string;
  content: string;
}

export const KNOWLEDGE_LIBRARY: KnowledgeItem[] = [
  {
    name: "security-headers",
    category: "security",
    description: "Essential HTTP security headers for web applications",
    content: `Essential Security Headers:
- Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
- X-XSS-Protection: 0 (CSP replaces this)
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  },
  {
    name: "docker-node",
    category: "deployment",
    description: "Production Node.js Dockerfile template",
    content: `FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S appuser -u 1001
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]`,
  },
  {
    name: "github-actions-node",
    category: "ci",
    description: "CI/CD pipeline for Node.js with GitHub Actions",
    content: `name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test
      - run: npm run build`,
  },
  {
    name: "env-config",
    category: "configuration",
    description: "Environment variable configuration pattern with validation",
    content: `import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);`,
  },
  {
    name: "error-handling",
    category: "patterns",
    description: "TypeScript error handling patterns with Result type",
    content: `type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
function err<E>(error: E): Result<never, E> { return { ok: false, error }; }

// Usage:
async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const user = await db.users.findUnique({ where: { id } });
    if (!user) return err(new Error("User not found"));
    return ok(user);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}`,
  },
  {
    name: "rate-limiter",
    category: "security",
    description: "Token bucket rate limiter implementation",
    content: `class RateLimiter {
  private tokens: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(private maxRequests: number, private windowMs: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const entry = this.tokens.get(key);
    if (!entry || now > entry.resetAt) {
      this.tokens.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.maxRequests) return false;
    entry.count++;
    return true;
  }
}`,
  },
  {
    name: "prisma-setup",
    category: "database",
    description: "Prisma ORM setup with connection pooling",
    content: `import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;`,
  },
  {
    name: "zod-validation",
    category: "validation",
    description: "Zod schema patterns for API input validation",
    content: `import { z } from "zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(13).max(150).optional(),
  role: z.enum(["user", "admin"]).default("user"),
  tags: z.array(z.string()).max(10).default([]),
});

type CreateUser = z.infer<typeof CreateUserSchema>;

// Express middleware:
function validate<T>(schema: z.ZodSchema<T>) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ errors: result.error.flatten() });
    req.body = result.data;
    next();
  };
}`,
  },
  {
    name: "testing-patterns",
    category: "testing",
    description: "Test organization and assertion patterns",
    content: `// Arrange-Act-Assert pattern
describe("UserService", () => {
  it("creates user with valid email", async () => {
    // Arrange
    const input = { email: "test@example.com", name: "Test" };

    // Act
    const user = await userService.create(input);

    // Assert
    expect(user.id).toBeDefined();
    expect(user.email).toBe(input.email);
  });

  it("rejects duplicate email", async () => {
    await userService.create({ email: "dup@test.com", name: "First" });
    await expect(userService.create({ email: "dup@test.com", name: "Second" }))
      .rejects.toThrow("already exists");
  });
});`,
  },
  {
    name: "git-hooks",
    category: "git",
    description: "Pre-commit and commit-msg hooks with lint-staged",
    content: `// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}

// .husky/pre-commit
npx lint-staged

// .husky/commit-msg
npx commitlint --edit $1

// commitlint.config.js
module.exports = { extends: ["@commitlint/config-conventional"] };`,
  },
];

/**
 * Search knowledge library by query.
 */
export function searchKnowledge(query: string): KnowledgeItem[] {
  const q = query.toLowerCase();
  return KNOWLEDGE_LIBRARY.filter(
    (item) =>
      item.name.includes(q) ||
      item.category.includes(q) ||
      item.description.toLowerCase().includes(q),
  );
}

/**
 * Auto-suggest knowledge items based on conversation context.
 * Returns formatted knowledge block if relevant item found.
 */
export function matchKnowledge(userInput: string): KnowledgeItem | null {
  const input = userInput.toLowerCase();

  // Direct keyword matches
  const keywordMap: Record<string, string> = {
    "security header": "security-headers",
    "csp": "security-headers",
    "content-security": "security-headers",
    "dockerfile": "docker-node",
    "docker": "docker-node",
    "github action": "github-actions-node",
    "ci/cd": "github-actions-node",
    "ci pipeline": "github-actions-node",
    "env config": "env-config",
    "environment variable": "env-config",
    "error handling": "error-handling",
    "result type": "error-handling",
    "rate limit": "rate-limiter",
    "throttle": "rate-limiter",
    "prisma": "prisma-setup",
    "zod": "zod-validation",
    "validation": "zod-validation",
    "test pattern": "testing-patterns",
    "arrange act assert": "testing-patterns",
    "git hook": "git-hooks",
    "pre-commit": "git-hooks",
    "lint-staged": "git-hooks",
    "husky": "git-hooks",
  };

  for (const [keyword, itemName] of Object.entries(keywordMap)) {
    if (input.includes(keyword)) {
      return KNOWLEDGE_LIBRARY.find((i) => i.name === itemName) || null;
    }
  }

  return null;
}
