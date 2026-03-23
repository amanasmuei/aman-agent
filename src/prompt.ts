import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function assembleSystemPrompt(): { prompt: string; layers: string[] } {
  const home = os.homedir();
  const layers: string[] = [];
  const parts: string[] = [];

  // Identity (acore)
  const corePath = path.join(home, ".acore", "core.md");
  if (fs.existsSync(corePath)) {
    parts.push(fs.readFileSync(corePath, "utf-8").trim());
    layers.push("identity");
  }

  // Project context
  const contextPath = path.join(process.cwd(), ".acore", "context.md");
  if (fs.existsSync(contextPath)) {
    parts.push(fs.readFileSync(contextPath, "utf-8").trim());
  }

  // Tools (akit)
  const kitPath = path.join(home, ".akit", "kit.md");
  if (fs.existsSync(kitPath)) {
    parts.push(fs.readFileSync(kitPath, "utf-8").trim());
    layers.push("tools");
  }

  // Workflows (aflow)
  const flowPath = path.join(home, ".aflow", "flow.md");
  if (fs.existsSync(flowPath)) {
    parts.push(fs.readFileSync(flowPath, "utf-8").trim());
    layers.push("workflows");
  }

  // Guardrails (arules)
  const rulesPath = path.join(home, ".arules", "rules.md");
  if (fs.existsSync(rulesPath)) {
    parts.push(fs.readFileSync(rulesPath, "utf-8").trim());
    layers.push("guardrails");
  }

  // Skills (askill)
  const skillsPath = path.join(home, ".askill", "skills.md");
  if (fs.existsSync(skillsPath)) {
    parts.push(fs.readFileSync(skillsPath, "utf-8").trim());
    layers.push("skills");
  }

  return {
    prompt: parts.join("\n\n---\n\n"),
    layers,
  };
}
