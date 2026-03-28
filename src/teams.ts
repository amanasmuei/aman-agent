import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import type { LLMClient, ToolDefinition } from "./llm/types.js";
import type { McpManager } from "./mcp/client.js";
import { delegateTask, delegateParallel, delegatePipeline, type DelegationResult } from "./delegate.js";
import { listProfiles } from "./prompt.js";
import { log } from "./logger.js";

// --- Types ---

export interface TeamMember {
  profile: string;
  role: string;
}

export interface Team {
  name: string;
  goal: string;
  coordinator: string; // profile name or "default" for main agent
  members: TeamMember[];
  workflow: "pipeline" | "parallel" | "coordinator";
}

export interface TeamRunResult {
  team: string;
  task: string;
  workflow: string;
  results: DelegationResult[];
  finalOutput: string;
  success: boolean;
}

// --- Storage ---

function getTeamsDir(): string {
  return path.join(os.homedir(), ".acore", "teams");
}

function ensureTeamsDir(): string {
  const dir = getTeamsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function teamPath(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return path.join(ensureTeamsDir(), `${slug}.json`);
}

// --- CRUD ---

export function createTeam(team: Team): void {
  const fp = teamPath(team.name);
  fs.writeFileSync(fp, JSON.stringify(team, null, 2), "utf-8");
}

export function loadTeam(name: string): Team | null {
  const fp = teamPath(name);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Team;
  } catch {
    return null;
  }
}

export function listTeams(): Team[] {
  const dir = getTeamsDir();
  if (!fs.existsSync(dir)) return [];

  const teams: Team[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      teams.push(JSON.parse(content) as Team);
    } catch { /* skip malformed */ }
  }
  return teams;
}

export function deleteTeam(name: string): boolean {
  const fp = teamPath(name);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

// --- Team Execution ---

/**
 * Run a task with a team. Routes to the appropriate execution mode.
 */
export async function runTeam(
  team: Team,
  task: string,
  client: LLMClient,
  mcpManager: McpManager,
  tools?: ToolDefinition[],
): Promise<TeamRunResult> {
  process.stdout.write(pc.dim(`\n  Team: ${team.name} (${team.workflow} mode)\n`));
  process.stdout.write(pc.dim(`  Members: ${team.members.map((m) => m.profile).join(", ")}\n\n`));

  switch (team.workflow) {
    case "pipeline":
      return runPipeline(team, task, client, mcpManager, tools);
    case "parallel":
      return runParallel(team, task, client, mcpManager, tools);
    case "coordinator":
      return runCoordinator(team, task, client, mcpManager, tools);
    default:
      return {
        team: team.name,
        task,
        workflow: team.workflow,
        results: [],
        finalOutput: `Unknown workflow mode: ${team.workflow}`,
        success: false,
      };
  }
}

/**
 * Pipeline mode: each member works sequentially, passing output to the next.
 */
async function runPipeline(
  team: Team,
  task: string,
  client: LLMClient,
  mcpManager: McpManager,
  tools?: ToolDefinition[],
): Promise<TeamRunResult> {
  const steps = team.members.map((m, i) => ({
    profile: m.profile,
    taskTemplate: i === 0
      ? `${task}\n\nYour role: ${m.role}`
      : `${m.role}. Here is the previous agent's work:\n\n{{input}}`,
  }));

  for (const step of steps) {
    process.stdout.write(pc.dim(`  [${step.profile}: ${team.members.find((m) => m.profile === step.profile)?.role}...]\n`));
  }

  const results = await delegatePipeline(steps, task, client, mcpManager, {
    tools,
    silent: true,
  });

  const lastResult = results[results.length - 1];
  const success = results.every((r) => r.success);

  return {
    team: team.name,
    task,
    workflow: "pipeline",
    results,
    finalOutput: lastResult?.response || "",
    success,
  };
}

/**
 * Parallel mode: all members work concurrently, coordinator merges results.
 */
async function runParallel(
  team: Team,
  task: string,
  client: LLMClient,
  mcpManager: McpManager,
  tools?: ToolDefinition[],
): Promise<TeamRunResult> {
  // Each member gets the task with their specific role
  const tasks = team.members.map((m) => ({
    profile: m.profile,
    task: `${task}\n\nYour specific role: ${m.role}. Focus only on your role.`,
  }));

  for (const m of team.members) {
    process.stdout.write(pc.dim(`  [${m.profile}: ${m.role} (parallel)...]\n`));
  }

  const results = await delegateParallel(tasks, client, mcpManager, { tools });

  // Merge results using coordinator (or main agent)
  const mergeInput = results
    .filter((r) => r.success)
    .map((r) => `[${r.profile} — ${team.members.find((m) => m.profile === r.profile)?.role}]:\n${r.response}`)
    .join("\n\n---\n\n");

  process.stdout.write(pc.dim(`  [merging results...]\n`));

  const mergeResult = await delegateTask(
    `You are the team coordinator. Multiple agents worked on this task in parallel. Merge their outputs into a single cohesive result. Keep the best parts from each.\n\nOriginal task: ${task}\n\n${mergeInput}`,
    team.coordinator === "default" ? team.members[0]?.profile || "default" : team.coordinator,
    client,
    mcpManager,
    { tools, silent: true },
  );

  return {
    team: team.name,
    task,
    workflow: "parallel",
    results: [...results, mergeResult],
    finalOutput: mergeResult.response,
    success: results.some((r) => r.success),
  };
}

/**
 * Coordinator mode: coordinator LLM decides how to route tasks to members.
 * Most flexible — coordinator analyzes the task and creates its own execution plan.
 */
async function runCoordinator(
  team: Team,
  task: string,
  client: LLMClient,
  mcpManager: McpManager,
  tools?: ToolDefinition[],
): Promise<TeamRunResult> {
  const memberDescriptions = team.members
    .map((m) => `- ${m.profile}: ${m.role}`)
    .join("\n");

  // Step 1: Coordinator plans the work
  process.stdout.write(pc.dim(`  [coordinator planning...]\n`));

  const planResult = await delegateTask(
    `You are the coordinator of a team. Your job is to break down this task and decide which team members should handle each part.

Team members:
${memberDescriptions}

Task: ${task}

Respond with a JSON array of assignments:
[{"profile": "member-name", "subtask": "what they should do"}]

Only use the JSON array, no other text.`,
    team.coordinator === "default" ? team.members[0]?.profile || "default" : team.coordinator,
    client,
    mcpManager,
    { tools: undefined, silent: true, maxTurns: 0 },
  );

  if (!planResult.success) {
    return {
      team: team.name,
      task,
      workflow: "coordinator",
      results: [planResult],
      finalOutput: `Coordinator failed to plan: ${planResult.error}`,
      success: false,
    };
  }

  // Step 2: Parse assignments
  let assignments: Array<{ profile: string; subtask: string }>;
  try {
    let cleaned = planResult.response.trim();
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();
    assignments = JSON.parse(cleaned);
  } catch {
    // Fallback: run all members in parallel with the full task
    assignments = team.members.map((m) => ({ profile: m.profile, subtask: `${m.role}: ${task}` }));
  }

  // Step 3: Execute assignments in parallel
  for (const a of assignments) {
    process.stdout.write(pc.dim(`  [${a.profile}: ${a.subtask.slice(0, 60)}...]\n`));
  }

  const results = await delegateParallel(
    assignments.map((a) => ({ profile: a.profile, task: a.subtask })),
    client,
    mcpManager,
    { tools },
  );

  // Step 4: Coordinator merges
  const mergeInput = results
    .filter((r) => r.success)
    .map((r, i) => `[${assignments[i]?.profile} — ${assignments[i]?.subtask}]:\n${r.response}`)
    .join("\n\n---\n\n");

  process.stdout.write(pc.dim(`  [coordinator merging...]\n`));

  const mergeResult = await delegateTask(
    `You are the team coordinator. Your team members completed their assigned work. Combine their outputs into a single cohesive, polished result.\n\nOriginal task: ${task}\n\n${mergeInput}`,
    team.coordinator === "default" ? team.members[0]?.profile || "default" : team.coordinator,
    client,
    mcpManager,
    { tools, silent: true },
  );

  return {
    team: team.name,
    task,
    workflow: "coordinator",
    results: [...results, mergeResult],
    finalOutput: mergeResult.response,
    success: results.some((r) => r.success),
  };
}

// --- Formatting ---

export function formatTeam(team: Team): string {
  const lines: string[] = [];
  lines.push(`Team: ${pc.bold(team.name)}`);
  lines.push(`Goal: ${team.goal}`);
  lines.push(`Mode: ${team.workflow}`);
  lines.push(`Coordinator: ${team.coordinator}`);
  lines.push("");
  lines.push("Members:");
  for (const m of team.members) {
    lines.push(`  ${pc.bold(m.profile)} — ${m.role}`);
  }
  return lines.join("\n");
}

export function formatTeamResult(result: TeamRunResult): string {
  const lines: string[] = [];
  lines.push(`\n${pc.bold(`Team: ${result.team}`)} (${result.workflow})`);

  for (const r of result.results) {
    const status = r.success ? pc.green("✓") : pc.red("✗");
    const tools = r.toolsUsed.length > 0 ? pc.dim(` (${r.toolsUsed.join(", ")})`) : "";
    lines.push(`  ${status} ${pc.bold(r.profile)}${tools}`);
  }

  lines.push("");
  lines.push(result.finalOutput);

  return lines.join("\n");
}

// --- Built-in Team Templates ---

export const BUILT_IN_TEAMS: Team[] = [
  {
    name: "content-team",
    goal: "Create and publish high-quality content",
    coordinator: "default",
    members: [
      { profile: "writer", role: "Draft compelling content with engaging narrative" },
      { profile: "researcher", role: "Fact-check claims and add citations" },
    ],
    workflow: "pipeline",
  },
  {
    name: "dev-team",
    goal: "Build and review code with quality assurance",
    coordinator: "default",
    members: [
      { profile: "coder", role: "Write clean, tested implementation code" },
      { profile: "researcher", role: "Review for security, performance, and best practices" },
    ],
    workflow: "pipeline",
  },
  {
    name: "research-team",
    goal: "Deep research with multiple perspectives",
    coordinator: "default",
    members: [
      { profile: "researcher", role: "Research the topic thoroughly with citations" },
      { profile: "writer", role: "Synthesize findings into clear, readable format" },
    ],
    workflow: "pipeline",
  },
];
