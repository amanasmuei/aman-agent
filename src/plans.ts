import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { log } from "./logger.js";

// --- Types ---

export interface PlanStep {
  text: string;
  done: boolean;
}

export interface Plan {
  name: string;
  goal: string;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

// --- Paths ---

function getPlansDir(): string {
  // Project-local plans if .acore exists, otherwise global
  const localDir = path.join(process.cwd(), ".acore", "plans");
  const localAcore = path.join(process.cwd(), ".acore");
  if (fs.existsSync(localAcore)) return localDir;
  return path.join(os.homedir(), ".acore", "plans");
}

function ensurePlansDir(): string {
  const dir = getPlansDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function planPath(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return path.join(ensurePlansDir(), `${slug}.md`);
}

// --- Serialization ---

function serializePlan(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# ${plan.name}`);
  lines.push("");
  lines.push(`**Goal:** ${plan.goal}`);
  lines.push(`**Created:** ${plan.createdAt}`);
  lines.push(`**Updated:** ${plan.updatedAt}`);
  lines.push(`**Active:** ${plan.active}`);
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  for (const step of plan.steps) {
    lines.push(`- [${step.done ? "x" : " "}] ${step.text}`);
  }
  lines.push("");
  return lines.join("\n");
}

function parsePlan(content: string, filePath: string): Plan | null {
  try {
    const nameMatch = content.match(/^# (.+)/m);
    const goalMatch = content.match(/\*\*Goal:\*\*\s*(.+)/);
    const createdMatch = content.match(/\*\*Created:\*\*\s*(.+)/);
    const updatedMatch = content.match(/\*\*Updated:\*\*\s*(.+)/);
    const activeMatch = content.match(/\*\*Active:\*\*\s*(.+)/);

    const name = nameMatch?.[1]?.trim() || path.basename(filePath, ".md");
    const goal = goalMatch?.[1]?.trim() || "";
    const createdAt = createdMatch?.[1]?.trim() || "";
    const updatedAt = updatedMatch?.[1]?.trim() || "";
    const active = activeMatch?.[1]?.trim() === "true";

    // Parse checkbox steps
    const steps: PlanStep[] = [];
    const stepMatches = content.matchAll(/- \[([ x])\] (.+)/g);
    for (const match of stepMatches) {
      steps.push({
        done: match[1] === "x",
        text: match[2].trim(),
      });
    }

    return { name, goal, steps, createdAt, updatedAt, active };
  } catch (err) {
    log.debug("plans", "Failed to parse plan: " + filePath, err);
    return null;
  }
}

// --- CRUD ---

export function createPlan(name: string, goal: string, steps: string[]): Plan {
  const now = new Date().toISOString().split("T")[0];
  const plan: Plan = {
    name,
    goal,
    steps: steps.map((text) => ({ text, done: false })),
    createdAt: now,
    updatedAt: now,
    active: true,
  };

  // Deactivate any currently active plan
  const existing = listPlans();
  for (const p of existing) {
    if (p.active) {
      p.active = false;
      p.updatedAt = now;
      savePlan(p);
    }
  }

  savePlan(plan);
  return plan;
}

export function savePlan(plan: Plan): void {
  const fp = planPath(plan.name);
  fs.writeFileSync(fp, serializePlan(plan), "utf-8");
}

export function loadPlan(name: string): Plan | null {
  const fp = planPath(name);
  if (!fs.existsSync(fp)) return null;
  const content = fs.readFileSync(fp, "utf-8");
  return parsePlan(content, fp);
}

export function listPlans(): Plan[] {
  const dir = getPlansDir();
  if (!fs.existsSync(dir)) return [];

  const plans: Plan[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const fp = path.join(dir, file);
    const content = fs.readFileSync(fp, "utf-8");
    const plan = parsePlan(content, fp);
    if (plan) plans.push(plan);
  }

  return plans;
}

export function getActivePlan(): Plan | null {
  const plans = listPlans();
  return plans.find((p) => p.active) || null;
}

// --- Operations ---

export function markStepDone(plan: Plan, stepIndex: number): boolean {
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return false;
  plan.steps[stepIndex].done = true;
  plan.updatedAt = new Date().toISOString().split("T")[0];
  savePlan(plan);
  return true;
}

export function markStepUndone(plan: Plan, stepIndex: number): boolean {
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return false;
  plan.steps[stepIndex].done = false;
  plan.updatedAt = new Date().toISOString().split("T")[0];
  savePlan(plan);
  return true;
}

export function setActivePlan(name: string): Plan | null {
  const now = new Date().toISOString().split("T")[0];

  // Deactivate all
  const plans = listPlans();
  for (const p of plans) {
    if (p.active) {
      p.active = false;
      p.updatedAt = now;
      savePlan(p);
    }
  }

  // Activate target
  const target = loadPlan(name);
  if (!target) return null;
  target.active = true;
  target.updatedAt = now;
  savePlan(target);
  return target;
}

// --- Formatting ---

export function formatPlan(plan: Plan): string {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = progressBar(pct);

  const lines: string[] = [];
  lines.push(`Plan: ${plan.name} ${plan.active ? "(active)" : "(inactive)"}`);
  lines.push(`Goal: ${plan.goal}`);
  lines.push(`Progress: ${bar} ${done}/${total} (${pct}%)`);
  lines.push("");

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const marker = step.done ? "✓" : " ";
    const num = String(i + 1).padStart(2, " ");
    lines.push(`  ${num}. [${marker}] ${step.text}`);
  }

  if (done === total && total > 0) {
    lines.push("\n  All steps complete!");
  } else {
    const next = plan.steps.findIndex((s) => !s.done);
    if (next >= 0) {
      lines.push(`\n  Next: Step ${next + 1} — ${plan.steps[next].text}`);
    }
  }

  return lines.join("\n");
}

export function formatPlanForPrompt(plan: Plan): string {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.done).length;

  const lines: string[] = [];
  lines.push(`<active-plan name="${plan.name}" progress="${done}/${total}">`);
  lines.push(`Goal: ${plan.goal}`);
  lines.push("");

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    lines.push(`- [${step.done ? "x" : " "}] Step ${i + 1}: ${step.text}`);
  }

  const next = plan.steps.findIndex((s) => !s.done);
  if (next >= 0) {
    lines.push("");
    lines.push(`Current focus: Step ${next + 1} — ${plan.steps[next].text}`);
    lines.push("After completing the current step, remind the user to mark it done with /plan done and suggest committing their work.");
  }

  lines.push("</active-plan>");
  return lines.join("\n");
}

function progressBar(pct: number): string {
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
