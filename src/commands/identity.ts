import fs from "node:fs";
import pc from "picocolors";
import {
  getIdentity as acoreGetIdentity,
  updateSection as acoreUpdateSection,
  updateDynamics as acoreUpdateDynamics,
} from "@aman_asmuei/acore-core";
import { loadUserModel, defaultModelPath } from "../user-model.js";
import {
  AGENT_SCOPE,
  type CommandContext,
  type CommandResult,
} from "./shared.js";

export async function handleIdentityCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    const identity = await acoreGetIdentity(AGENT_SCOPE);
    if (!identity) {
      return {
        handled: true,
        output: pc.dim(
          `No identity configured for ${AGENT_SCOPE}. Run: npx @aman_asmuei/acore`,
        ),
      };
    }
    return { handled: true, output: identity.content.trim() };
  }
  if (action === "update") {
    if (args.length === 0) {
      return {
        handled: true,
        output: pc.yellow(
          "Usage: /identity update <section>\nTip: describe changes in natural language and the AI will update via acore-core.",
        ),
      };
    }
    const section = args[0];
    const content = args.slice(1).join(" ");
    if (!content) {
      return {
        handled: true,
        output: pc.yellow(
          "Usage: /identity update <section> <new content...>\nExample: /identity update Personality Warm, curious, and direct.",
        ),
      };
    }
    try {
      await acoreUpdateSection(section, content, AGENT_SCOPE);
      return { handled: true, output: pc.green(`Updated section: ${section}`) };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Failed to update ${section}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      };
    }
  }
  if (action === "dynamics") {
    if (args.includes("--json")) {
      const model = await loadUserModel();
      if (!model) return { handled: true, output: pc.dim("No user model yet. Complete a few sessions first.") };
      return { handled: true, output: JSON.stringify(model, null, 2) };
    }

    if (args.includes("--reset")) {
      const modelPath = defaultModelPath();
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        return { handled: true, output: pc.green("User model reset. Starting fresh.") };
      }
      return { handled: true, output: pc.dim("No user model to reset.") };
    }

    const updates: Record<string, string> = {};
    for (const arg of args) {
      const eq = arg.indexOf("=");
      if (eq > 0) updates[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
    if (Object.keys(updates).length > 0) {
      try {
        await acoreUpdateDynamics({
          energy: updates.energy,
          activeMode: updates.mode,
          currentRead: updates.read,
        }, AGENT_SCOPE);
        return { handled: true, output: `Dynamics updated: ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(", ")}` };
      } catch (err) {
        return { handled: true, output: pc.red(`Dynamics error: ${err instanceof Error ? err.message : String(err)}`) };
      }
    }

    const model = await loadUserModel();
    if (!model) {
      return { handled: true, output: pc.dim("No user model yet. Complete a few sessions to start building your profile.") };
    }

    const p = model.profile;
    const trustBar = "█".repeat(Math.round(p.trustScore * 10)) + "░".repeat(10 - Math.round(p.trustScore * 10));
    const frustBar = "█".repeat(Math.round(p.baselineFrustration * 10)) + "░".repeat(10 - Math.round(p.baselineFrustration * 10));

    const lines = [
      pc.bold("  Dynamic User Model"),
      "",
      `  ${pc.cyan("Trust")}        ${trustBar} ${(p.trustScore * 100).toFixed(0)}%  ${p.trustTrajectory === "ascending" ? pc.green("↑") : p.trustTrajectory === "declining" ? pc.red("↓") : "→"}`,
      `  ${pc.cyan("Sessions")}     ${p.totalSessions} total (${model.sessions.length} in window)`,
      `  ${pc.cyan("Sentiment")}    ${frustBar} frustration baseline  ${p.sentimentTrend === "improving" ? pc.green("improving") : p.sentimentTrend === "worsening" ? pc.red("worsening") : "stable"}`,
      "",
      `  ${pc.cyan("Preferred")}    ${p.preferredTimePeriod} (${Object.entries(p.energyDistribution).map(([k, v]) => `${k}: ${v}`).join(", ")})`,
      `  ${pc.cyan("Avg session")}  ${p.avgSessionMinutes.toFixed(0)} min, ${p.avgTurnsPerSession.toFixed(0)} turns  ${p.engagementTrend === "increasing" ? pc.green("↑") : p.engagementTrend === "decreasing" ? pc.red("↓") : "→"}`,
    ];

    if (p.totalSessions >= 10) {
      const corrs: string[] = [];
      if (Math.abs(p.frustrationCorrelations.toolErrors) > 0.3) {
        corrs.push(`tool errors (${p.frustrationCorrelations.toolErrors.toFixed(2)})`);
      }
      if (Math.abs(p.frustrationCorrelations.longSessions) > 0.3) {
        corrs.push(`long sessions (${p.frustrationCorrelations.longSessions.toFixed(2)})`);
      }
      if (Math.abs(p.frustrationCorrelations.lateNight) > 0.3) {
        corrs.push(`late night (${p.frustrationCorrelations.lateNight.toFixed(2)})`);
      }
      if (corrs.length > 0) {
        lines.push(`  ${pc.cyan("Frustration")}  correlates with: ${corrs.join(", ")}`);
      }
    }

    const nudgeKeys = Object.keys(p.nudgeStats);
    if (nudgeKeys.length > 0) {
      lines.push("");
      lines.push(`  ${pc.cyan("Nudges")}       ${nudgeKeys.map(k => `${k}: ${p.nudgeStats[k].fired}×`).join(", ")}`);
    }

    lines.push("");
    lines.push(pc.dim(`  Use --json for raw data, --reset to start fresh`));

    return { handled: true, output: lines.join("\n") };
  }
  if (action === "summary") {
    try {
      const identity = await acoreGetIdentity(AGENT_SCOPE);
      if (!identity) return { handled: true, output: pc.yellow("No identity configured.") };
      const nameMatch = identity.content.match(/\*\*Name:\*\*\s*(.+)/);
      const lines = [
        `**Identity Summary**`,
        nameMatch ? `Name: ${nameMatch[1].trim()}` : "",
        `Scope: ${AGENT_SCOPE}`,
      ].filter(Boolean);
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Summary error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "help") {
    return {
      handled: true,
      output: [
        pc.bold("Identity commands:"),
        `  ${pc.cyan("/identity")}                  View current identity`,
        `  ${pc.cyan("/identity update")} <section>  Update a section`,
        `  ${pc.cyan("/identity dynamics")}           View user model (trust, sentiment, patterns)`,
        `  ${pc.cyan("/identity dynamics")} key=val   Update dynamic fields (energy, mode, read)`,
        `  ${pc.cyan("/identity dynamics")} --json    Raw JSON user model`,
        `  ${pc.cyan("/identity dynamics")} --reset   Reset user model`,
        `  ${pc.cyan("/identity summary")}            Show structured identity summary`,
      ].join("\n"),
    };
  }
  return {
    handled: true,
    output: pc.yellow(
      `Unknown action: /identity ${action}. Try /identity --help`,
    ),
  };
}
