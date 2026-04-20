import pc from "picocolors";
import { getEcosystemStatus } from "../layers/parsers.js";
import { isMemoryInitialized } from "../memory.js";
import type { CommandContext, CommandResult } from "./shared.js";

export function handleStatusCommand(ctx: CommandContext): CommandResult {
  const mcpToolCount = ctx.mcpManager ? ctx.mcpManager.getTools().length : 0;
  const amemConnected = isMemoryInitialized();
  const status = getEcosystemStatus(mcpToolCount, amemConnected);

  const lines: string[] = [pc.bold("Aman Ecosystem Dashboard"), ""];

  for (const layer of status.layers) {
    const icon = layer.exists ? pc.green("\u25cf") : pc.dim("\u25cb");
    const name = pc.bold(layer.name.padEnd(12));
    const summary = layer.exists ? layer.summary : pc.dim("not configured");
    lines.push(`  ${icon} ${name} ${summary}`);
  }

  lines.push("");
  lines.push(`  ${status.mcpConnected ? pc.green("\u25cf") : pc.dim("\u25cb")} ${pc.bold("MCP".padEnd(12))} ${status.mcpConnected ? `${status.mcpToolCount} tools available` : pc.dim("not connected")}`);
  lines.push(`  ${status.amemConnected ? pc.green("\u25cf") : pc.dim("\u25cb")} ${pc.bold("Memory".padEnd(12))} ${status.amemConnected ? "connected" : pc.dim("not connected")}`);

  return { handled: true, output: lines.join("\n") };
}

export function handleDoctorCommand(ctx: CommandContext): CommandResult {
  const mcpToolCount = ctx.mcpManager ? ctx.mcpManager.getTools().length : 0;
  const amemConnected = isMemoryInitialized();
  const status = getEcosystemStatus(mcpToolCount, amemConnected);

  const lines: string[] = [pc.bold("Aman Health Check"), ""];
  let healthy = 0;
  let fixes = 0;
  let suggestions = 0;

  for (const layer of status.layers) {
    if (layer.exists) {
      lines.push(`  ${pc.green("\u2713")} ${layer.name.padEnd(12)} ${pc.green(layer.summary)}`);
      healthy++;
    } else {
      const isRequired = ["identity", "rules"].includes(layer.name.toLowerCase());
      if (isRequired) {
        lines.push(`  ${pc.red("\u2717")} ${layer.name.padEnd(12)} ${pc.red("missing")}`);
        lines.push(`    ${pc.dim("\u2192 Fix: aman-agent init")}`);
        fixes++;
      } else {
        lines.push(`  ${pc.yellow("\u26a0")} ${layer.name.padEnd(12)} ${pc.yellow("empty")}`);
        const cmd = layer.name.toLowerCase() === "workflows" ? "/workflows add <name>"
          : layer.name.toLowerCase() === "tools" ? "/tools add <name> <type> <desc>"
          : layer.name.toLowerCase() === "skills" ? "/skills install <name>"
          : "";
        if (cmd) lines.push(`    ${pc.dim(`\u2192 Add with ${cmd}`)}`);
        suggestions++;
      }
    }
  }

  lines.push("");
  lines.push(`  ${status.mcpConnected ? pc.green("\u2713") : pc.red("\u2717")} ${"MCP".padEnd(12)} ${status.mcpConnected ? pc.green(`${status.mcpToolCount} tools`) : pc.red("not connected")}`);
  if (!status.mcpConnected) {
    lines.push(`    ${pc.dim("\u2192 Fix: ensure npx is available and network is connected")}`);
    fixes++;
  } else {
    healthy++;
  }

  lines.push(`  ${status.amemConnected ? pc.green("\u2713") : pc.red("\u2717")} ${"Memory".padEnd(12)} ${status.amemConnected ? pc.green("connected") : pc.red("not connected")}`);
  if (!status.amemConnected) {
    lines.push(`    ${pc.dim("\u2192 Fix: restart aman-agent (memory initializes automatically)")}`);
    fixes++;
  } else {
    healthy++;
  }

  const total = healthy + fixes + suggestions;
  lines.push("");
  lines.push(`  Overall: ${healthy}/${total} healthy.${fixes > 0 ? ` ${fixes} fix${fixes > 1 ? "es" : ""} needed.` : ""}${suggestions > 0 ? ` ${suggestions} suggestion${suggestions > 1 ? "s" : ""}.` : ""}`);

  return { handled: true, output: lines.join("\n") };
}
