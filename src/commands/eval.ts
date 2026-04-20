import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import {
  loadUserModel,
  computeProfile,
  predictBurnout,
} from "../user-model.js";
import { loadTaskLog } from "../background.js";
import {
  readEcosystemFile,
  mcpWrite,
  type CommandContext,
  type CommandResult,
} from "./shared.js";

export async function handleEvalCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".aeval", "eval.md"), "evaluation (aeval)");
    return { handled: true, output: content };
  }
  if (action === "milestone") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /eval milestone <text...>") };
    }
    const text = args.join(" ");
    const output = await mcpWrite(ctx, "eval", "eval_milestone", { text });
    return { handled: true, output };
  }
  if (action === "report") {
    const evalFile = path.join(home, ".aeval", "eval.md");
    const lines: string[] = [pc.bold("📊 Eval Report")];

    if (fs.existsSync(evalFile)) {
      lines.push("", fs.readFileSync(evalFile, "utf-8").trim());
    } else {
      lines.push("", pc.dim("No eval log yet. Use /eval milestone <text> to start."));
    }

    try {
      const model = await loadUserModel();
      if (model && model.sessions.length >= 3) {
        const profile = computeProfile(model.sessions, model.profile.totalSessions);
        const burnout = predictBurnout(model.sessions);
        lines.push("", pc.bold("── Analytics ──"));
        lines.push(`  Sessions tracked: ${pc.cyan(String(profile.totalSessions))}`);
        lines.push(`  Trust score:      ${pc.cyan(profile.trustScore.toFixed(2))}`);
        lines.push(`  Sentiment trend:  ${pc.cyan(profile.sentimentTrend)}`);

        const topEnergy = Object.entries(profile.energyDistribution)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`);
        lines.push(`  Top energy:       ${pc.cyan(topEnergy.join(", "))}`);

        const riskColor = burnout.risk > 0.7 ? pc.red : burnout.risk > 0.4 ? pc.yellow : pc.green;
        lines.push(`  Burnout risk:     ${riskColor((burnout.risk * 100).toFixed(0) + "%")} ${burnout.factors.length > 0 ? pc.dim("(" + burnout.factors.join(", ") + ")") : ""}`);

        const cors = Object.entries(profile.frustrationCorrelations)
          .filter(([, v]) => Math.abs(v) > 0.3)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 3);
        if (cors.length > 0) {
          lines.push(`  Frustration corr: ${cors.map(([k, v]) => `${k} ${v > 0 ? "↑" : "↓"}${Math.abs(v).toFixed(2)}`).join(", ")}`);
        }
      }
    } catch {
      // User model unavailable — skip analytics silently
    }

    try {
      const taskLog = loadTaskLog();
      if (taskLog.length > 0) {
        const completed = taskLog.filter((t) => t.status === "completed").length;
        const failed = taskLog.filter((t) => t.status === "failed").length;
        const interrupted = taskLog.filter((t) => t.status === "interrupted").length;
        lines.push("", pc.bold("── Background Tasks ──"));
        lines.push(`  Total: ${taskLog.length}  ✅ ${completed}  ❌ ${failed}  ⚠️ ${interrupted}`);
      }
    } catch {
      // Task log unavailable — skip
    }

    return { handled: true, output: lines.join("\n") };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /eval ${action}. Use /eval, /eval report, or /eval milestone <text>.`) };
}
