import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import { loadShowcaseManifest, installShowcaseTemplate } from "../showcase-bridge.js";
import type { CommandResult } from "./shared.js";

export function handleShowcaseCommand(action: string | undefined, args: string[]): CommandResult {
  const showcases = loadShowcaseManifest();

  if (showcases.length === 0) {
    return {
      handled: true,
      output: pc.dim("No showcase templates found.") +
        "\n\n  Install aman-showcase to get 13 pre-built companion personalities:" +
        `\n  ${pc.bold("npm install -g @aman_asmuei/aman-showcase")}` +
        "\n  Or place it as a sibling directory to aman-agent.",
    };
  }

  const corePath = path.join(os.homedir(), ".acore", "core.md");
  let currentShowcase: string | null = null;
  if (fs.existsSync(corePath)) {
    const content = fs.readFileSync(corePath, "utf-8");
    const nameMatch = content.match(/^# (.+)/m);
    if (nameMatch) {
      const coreName = nameMatch[1].trim().toLowerCase();
      const match = showcases.find((s) => coreName.includes(s.name) || coreName.includes(s.title.split("\u2014")[0].trim().toLowerCase()));
      if (match) currentShowcase = match.name;
    }
  }

  if (!action || action === "list") {
    const lines = showcases.map((s) => {
      const active = s.name === currentShowcase ? pc.green(" \u2190 active") : "";
      const langBadge = s.language === "ms" ? " [BM]" : s.language === "en+ms" ? " [EN/BM]" : "";
      return `  ${pc.bold(s.name.padEnd(12))} ${s.title}${langBadge}${active}`;
    });
    const currentLine = currentShowcase
      ? `\nCurrent: ${pc.bold(currentShowcase)}\n`
      : `\nNo showcase active (using default personality)\n`;
    return {
      handled: true,
      output: `Showcase templates (${showcases.length}):\n\n${lines.join("\n")}\n${currentLine}\n${pc.dim("Switch with: /showcase install <name>")}`,
    };
  }

  if (action === "install" || action === "switch" || action === "use") {
    const name = args[0];
    if (!name) {
      return { handled: true, output: pc.yellow("Usage: /showcase install <name>\n\nRun /showcase list to see available templates.") };
    }

    const entry = showcases.find((s) => s.name === name);
    if (!entry) {
      return { handled: true, output: pc.red(`Showcase not found: ${name}`) + `\n\nAvailable: ${showcases.map((s) => s.name).join(", ")}` };
    }

    if (name === currentShowcase) {
      return { handled: true, output: pc.dim(`${entry.title} is already active.`) };
    }

    try {
      const result = installShowcaseTemplate(name);
      const lines = [pc.green(`Installed ${pc.bold(entry.title)}`)];
      for (const f of result.installed) {
        lines.push(pc.dim(`  ${f}`));
      }
      if (result.backed_up.length > 0) {
        lines.push(pc.dim(`\n  Backed up ${result.backed_up.length} existing file(s) (.bak)`));
      }
      lines.push("");
      lines.push(pc.yellow("Restart aman-agent to use the new personality."));
      lines.push(pc.dim("Your user profile (/profile me) is unchanged \u2014 only the AI personality switched."));
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Failed to install: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }

  if (action === "current") {
    if (currentShowcase) {
      const entry = showcases.find((s) => s.name === currentShowcase);
      return { handled: true, output: `Active showcase: ${pc.bold(entry?.title || currentShowcase)}\n${pc.dim(entry?.description || "")}` };
    }
    return { handled: true, output: pc.dim("No showcase active \u2014 using default personality.") + `\n${pc.dim("Install one with: /showcase install <name>")}` };
  }

  if (action === "help") {
    return { handled: true, output: `Showcase commands:

  /showcase              List all available templates
  /showcase install <n>  Install/switch to a template
  /showcase current      Show active template

${pc.dim("Showcase templates replace your AI's personality, workflows, rules, and skills.")}
${pc.dim("Your user profile (/profile me) stays unchanged \u2014 only the AI personality switches.")}
${pc.dim("Existing files are backed up (.bak) before overwriting.")}` };
  }

  return { handled: true, output: pc.yellow(`Unknown action: /showcase ${action}. Try /showcase help`) };
}
