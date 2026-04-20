import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import {
  validateCandidate,
  writeSkillToFile,
  appendCrystallizationLog,
} from "../crystallization.js";
import {
  readEcosystemFile,
  mcpWrite,
  type CommandContext,
  type CommandResult,
} from "./shared.js";

export async function handleSkillsCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const home = os.homedir();
  if (!action) {
    const content = readEcosystemFile(path.join(home, ".askill", "skills.md"), "skills (askill)");
    return { handled: true, output: content };
  }
  if (action === "install") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /skills install <name>") };
    }
    const output = await mcpWrite(ctx, "skills", "skill_install", { name: args.join(" ") });
    return { handled: true, output };
  }
  if (action === "uninstall") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /skills uninstall <name>") };
    }
    const output = await mcpWrite(ctx, "skills", "skill_uninstall", { name: args.join(" ") });
    return { handled: true, output };
  }
  if (action === "search") {
    if (args.length === 0) {
      return { handled: true, output: pc.yellow("Usage: /skills search <query...>") };
    }
    const query = args.join(" ").toLowerCase();
    const raw = readEcosystemFile(path.join(home, ".askill", "skills.md"), "skills (askill)");
    if (raw.startsWith("No ")) {
      return { handled: true, output: raw };
    }
    const lines = raw.split("\n");
    const matches = lines.filter(l => l.toLowerCase().includes(query));
    if (matches.length === 0) {
      return { handled: true, output: pc.dim(`No skills matching "${query}".`) };
    }
    return { handled: true, output: [pc.bold(`Skills matching "${query}":`), ...matches].join("\n") };
  }
  if (action === "list") {
    const autoOnly = args.includes("--auto");
    if (autoOnly) {
      const logPath = path.join(os.homedir(), ".aman-agent", "crystallization-log.json");
      try {
        const content = fs.readFileSync(logPath, "utf-8");
        const entries = JSON.parse(content) as Array<{
          name: string;
          createdAt: string;
          fromPostmortem: string;
          confidence: number;
          triggers: string[];
        }>;
        if (entries.length === 0) {
          return { handled: true, output: pc.dim("No crystallized skills yet.") };
        }
        const suggestionsPath = path.join(os.homedir(), ".aman-agent", "crystallization-suggestions.json");
        let sugCounts: Record<string, number> = {};
        try {
          const sc = fs.readFileSync(suggestionsPath, "utf-8");
          sugCounts = JSON.parse(sc);
        } catch { /* noop */ }

        let versionCounts: Record<string, number> = {};
        try {
          const skillsContent = fs.readFileSync(path.join(os.homedir(), ".askill", "skills.md"), "utf-8");
          const versionRe = /^# (.+)\.v(\d+)$/gm;
          let vMatch;
          while ((vMatch = versionRe.exec(skillsContent)) !== null) {
            const skillHeading = vMatch[1].toLowerCase().replace(/ /g, "-");
            const ver = parseInt(vMatch[2], 10);
            versionCounts[skillHeading] = Math.max(versionCounts[skillHeading] || 0, ver);
          }
        } catch { /* noop */ }

        const lines = [pc.bold(`Crystallized skills (${entries.length}):`)];
        for (const entry of entries) {
          const date = entry.createdAt.slice(0, 10);
          const count = sugCounts[entry.name];
          const reinforced = count && count >= 3 ? pc.green(` ★ reinforced (${count}×)`) : "";
          const versions = versionCounts[entry.name];
          const versionLabel = versions ? pc.dim(` [v${versions + 1}]`) : "";
          lines.push(`  ${pc.cyan(entry.name)} (${date}, conf ${entry.confidence})${reinforced}${versionLabel}`);
          lines.push(pc.dim(`    triggers: ${entry.triggers.join(", ")}`));
        }
        return { handled: true, output: lines.join("\n") };
      } catch {
        return { handled: true, output: pc.dim("No crystallized skills yet.") };
      }
    }
    const content = readEcosystemFile(path.join(home, ".askill", "skills.md"), "skills (askill)");
    return { handled: true, output: content };
  }
  if (action === "crystallize") {
    const pmDir = path.join(os.homedir(), ".acore", "postmortems");
    try {
      const files = fs.readdirSync(pmDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
      if (jsonFiles.length === 0) {
        return {
          handled: true,
          output: pc.dim("No post-mortems found. Run a session that triggers a post-mortem first."),
        };
      }
      const latest = jsonFiles[0];
      const content = fs.readFileSync(path.join(pmDir, latest), "utf-8");
      const report = JSON.parse(content);
      if (
        !report.crystallizationCandidates ||
        report.crystallizationCandidates.length === 0
      ) {
        return {
          handled: true,
          output: pc.dim(`No crystallization candidates in the most recent post-mortem (${latest}). Run a longer session or wait for the next auto-postmortem.`),
        };
      }

      const skillsMdPath = path.join(os.homedir(), ".askill", "skills.md");
      const logPath = path.join(os.homedir(), ".aman-agent", "crystallization-log.json");
      const postmortemFilename = latest.replace(/\.json$/, ".md");

      const lines: string[] = [
        pc.bold(`Found ${report.crystallizationCandidates.length} candidate(s) in ${latest}:`),
      ];
      let written = 0;
      for (const raw of report.crystallizationCandidates) {
        const candidate = validateCandidate(raw);
        if (!candidate) {
          const rawName = (raw as { name?: string }).name ?? "unknown";
          lines.push(pc.dim(`  \u2298 ${rawName} \u2014 failed validation`));
          continue;
        }
        const result = await writeSkillToFile(candidate, skillsMdPath, postmortemFilename);
        if (result.written) {
          written++;
          lines.push(pc.green(`  \u2713 Crystallized: ${candidate.name}`));
          await appendCrystallizationLog(
            {
              name: candidate.name,
              createdAt: new Date().toISOString(),
              fromPostmortem: postmortemFilename,
              confidence: candidate.confidence,
              triggers: candidate.triggers,
            },
            logPath,
          );
        } else {
          lines.push(pc.yellow(`  \u2298 ${candidate.name} \u2014 ${result.reason}`));
        }
      }

      if (written > 0) {
        lines.push("");
        lines.push(pc.dim(`Crystallized skills will auto-activate in your next session.`));
      }

      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(`Failed to load post-mortems: ${err instanceof Error ? err.message : String(err)}`),
      };
    }
  }
  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Skills commands:"),
      `  ${pc.cyan("/skills")}                      View installed skills`,
      `  ${pc.cyan("/skills install")} <name>        Install a skill`,
      `  ${pc.cyan("/skills uninstall")} <name>      Uninstall a skill`,
      `  ${pc.cyan("/skills search")} <query>         Search skills by name/description`,
      `  ${pc.cyan("/skills crystallize")}            Crystallize skills from most recent post-mortem`,
      `  ${pc.cyan("/skills list --auto")}            List crystallized (auto-created) skills`,
    ].join("\n") };
  }
  return { handled: true, output: pc.yellow(`Unknown action: /skills ${action}. Try /skills --help`) };
}
