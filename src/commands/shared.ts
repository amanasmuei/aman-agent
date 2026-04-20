import fs from "node:fs";
import pc from "picocolors";
import type { McpManager } from "../mcp/client.js";
import type { ObservationSession } from "../observation.js";

/**
 * Canonical scope for aman-agent's slash commands. The CLI runtime is
 * the dev's `dev:agent` surface — distinct from `dev:plugin` (Claude Code)
 * and `dev:default` (the legacy single-tenant catch-all).
 *
 * Override at runtime with $AMAN_AGENT_SCOPE if you want a different
 * default (e.g. `dev:work` vs `dev:personal`).
 */
export const AGENT_SCOPE: string =
  process.env.AMAN_AGENT_SCOPE ?? "dev:agent";

export interface CommandResult {
  handled: boolean;
  output?: string;
  quit?: boolean;
  clearHistory?: boolean;
  saveConversation?: boolean;
  exportConversation?: boolean;
}

export interface CommandContext {
  model?: string;
  mcpManager?: McpManager;
  llmClient?: import("../llm/types.js").LLMClient;
  tools?: import("../llm/types.js").ToolDefinition[];
  observationSession?: ObservationSession;
  messages?: import("../llm/types.js").Message[];
}

export function readEcosystemFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    return pc.dim(`No ${label} file found at ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8").trim();
}

export function parseCommand(input: string): { base: string; action?: string; args: string[] } {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const base = parts[0].toLowerCase().replace(/^\//, "");
  let action = parts.length > 1 ? parts[1].toLowerCase() : undefined;
  if (action === "--help" || action === "-h") action = "help";
  const args = parts.slice(2);
  return { base, action, args };
}

/**
 * Parse dot-notation key (e.g. "consolidation.maxStaleDays") into nested object.
 * Returns { consolidation: { maxStaleDays: val } } instead of { "consolidation.maxStaleDays": val }
 */
export function buildNestedUpdate(key: string, val: unknown): Record<string, unknown> {
  const parts = key.split(".");
  if (parts.length === 1) return { [key]: val };
  const result: Record<string, unknown> = {};
  let curr = result;
  for (let i = 0; i < parts.length - 1; i++) {
    curr[parts[i]] = {};
    curr = curr[parts[i]] as Record<string, unknown>;
  }
  curr[parts[parts.length - 1]] = val;
  return result;
}

export async function mcpWrite(
  ctx: CommandContext,
  layer: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!ctx.mcpManager) {
    return pc.red(`Cannot modify ${layer}: aman-mcp not connected. Start it with: npx @aman_asmuei/aman-mcp`);
  }
  const result = await ctx.mcpManager.callTool(tool, args);
  if (result.startsWith("Error")) {
    return pc.red(result);
  }
  return pc.green(result);
}
