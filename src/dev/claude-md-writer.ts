import fs from "node:fs";
import path from "node:path";
import type { StackProfile } from "./stack-detector.js";

export interface ProjectContext {
  stack: StackProfile;
  conventions: string[];
  decisions: string[];
  corrections: string[];
  preferences: string[];
  rules: string[];
  metadata: {
    generatedAt: number;
    mode: "template" | "smart";
    memoriesUsed: number;
  };
}

export interface MarkerInfo {
  generatedAt: Date;
  memories: number;
  mode: string;
}

export interface WriteResult {
  written: boolean;
  backedUp: boolean;
  path: string;
}

export interface StalenessResult {
  status: "missing" | "no-marker" | "fresh" | "stale";
  generatedAt?: Date;
}

function formatStack(stack: StackProfile): string {
  const parts: string[] = [];
  const goFrameworks = ["fiber", "gin", "chi", "echo"];
  const jsFrameworks = ["next", "react", "remix", "express", "fastify", "hono", "nestjs", "vue", "svelte", "nuxt"];
  const pyFrameworks = ["django", "fastapi", "flask"];

  for (const lang of stack.languages) {
    const fw = stack.frameworks.filter((f) => {
      if (lang === "go" && goFrameworks.includes(f)) return true;
      if ((lang === "typescript" || lang === "javascript") && jsFrameworks.includes(f)) return true;
      if (lang === "python" && pyFrameworks.includes(f)) return true;
      if (lang === "dart" && f === "flutter") return true;
      return false;
    });
    const name = lang.charAt(0).toUpperCase() + lang.slice(1);
    if (fw.length > 0) {
      parts.push(`${name} (${fw.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(", ")})`);
    } else {
      parts.push(name);
    }
  }
  if (stack.databases.length > 0) {
    parts.push(...stack.databases.map((d) => d.charAt(0).toUpperCase() + d.slice(1)));
  }
  return parts.join(" + ");
}

export function renderToString(ctx: ProjectContext): string {
  const lines: string[] = [];
  const ts = new Date(ctx.metadata.generatedAt).toISOString();

  lines.push(`# Project: ${ctx.stack.projectName}`);
  lines.push(`<!-- aman-agent:dev generated=${ts} memories=${ctx.metadata.memoriesUsed} mode=${ctx.metadata.mode} -->`);
  lines.push("");

  const stackLine = formatStack(ctx.stack);
  if (stackLine || ctx.stack.infra.length > 0) {
    lines.push("## Stack");
    if (stackLine) lines.push(`- ${stackLine}`);
    if (ctx.stack.infra.length > 0) {
      lines.push(`- Infra: ${ctx.stack.infra.join(", ")}`);
    }
    if (ctx.stack.isMonorepo) {
      lines.push("- Monorepo");
    }
    lines.push("");
  }

  if (ctx.conventions.length > 0) {
    lines.push("## Conventions");
    for (const c of ctx.conventions) lines.push(`- ${c}`);
    lines.push("");
  }

  if (ctx.decisions.length > 0) {
    lines.push("## Past Decisions");
    for (const d of ctx.decisions) lines.push(`- ${d}`);
    lines.push("");
  }

  if (ctx.corrections.length > 0) {
    lines.push("## Corrections");
    for (const c of ctx.corrections) lines.push(`- ${c}`);
    lines.push("");
  }

  if (ctx.preferences.length > 0) {
    lines.push("## Developer Preferences");
    for (const p of ctx.preferences) lines.push(`- ${p}`);
    lines.push("");
  }

  if (ctx.rules.length > 0) {
    lines.push("## Rules");
    for (const r of ctx.rules) lines.push(`- ${r}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function parseMarker(content: string): MarkerInfo | null {
  const match = content.match(
    /<!--\s*aman-agent:dev\s+generated=(\S+)\s+memories=(\d+)\s+mode=(\S+)\s*-->/,
  );
  if (!match) return null;
  return {
    generatedAt: new Date(match[1]),
    memories: parseInt(match[2], 10),
    mode: match[3],
  };
}

export function checkStaleness(projectPath: string): StalenessResult {
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");
  if (!fs.existsSync(claudeMdPath)) {
    return { status: "missing" };
  }
  const content = fs.readFileSync(claudeMdPath, "utf-8");
  const marker = parseMarker(content);
  if (!marker) {
    return { status: "no-marker" };
  }
  return { status: "fresh", generatedAt: marker.generatedAt };
}

export function writeClaudeMd(ctx: ProjectContext, projectPath: string): WriteResult {
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");
  let backedUp = false;

  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    const marker = parseMarker(content);
    if (!marker) {
      fs.copyFileSync(claudeMdPath, `${claudeMdPath}.bak`);
      backedUp = true;
    }
  }

  const md = renderToString(ctx);
  fs.writeFileSync(claudeMdPath, md, "utf-8");

  return { written: true, backedUp, path: claudeMdPath };
}
