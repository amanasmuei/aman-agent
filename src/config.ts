import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface HooksConfig {
  memoryRecall?: boolean;
  sessionResume?: boolean;
  rulesCheck?: boolean;
  workflowSuggest?: boolean;
  evalPrompt?: boolean;
  autoSessionSave?: boolean;
  extractMemories?: boolean;
  featureHints?: boolean;
  personalityAdapt?: boolean;
  recordObservations?: boolean;
  autoPostmortem?: boolean;
}

const DEFAULT_HOOKS: HooksConfig = {
  memoryRecall: true,
  sessionResume: true,
  rulesCheck: true,
  workflowSuggest: true,
  evalPrompt: true,
  autoSessionSave: true,
  extractMemories: true,
  featureHints: true,
  personalityAdapt: true,
};

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MemoryConfig {
  maxStaleDays?: number;
  minConfidence?: number;
  minAccessCount?: number;
  maxRecallTokens?: number;
}

export interface AgentConfig {
  provider: "anthropic" | "openai" | "ollama" | "claude-code" | "copilot";
  apiKey: string;
  model: string;
  ollamaUrl?: string;
  maxOutputTokens?: number;
  hooks?: HooksConfig;
  mcpServers?: Record<string, McpServerEntry>;
  memory?: MemoryConfig;
}

/**
 * Resolve the aman-agent config directory, honoring `AMAN_AGENT_HOME`
 * if set. This matches the behavior of `src/server/registry.ts` so that
 * tests and tooling can isolate state via a single environment variable.
 *
 * Previously this module hardcoded `os.homedir()`, which broke hermetic
 * test isolation — child processes spawned with `AMAN_AGENT_HOME=<tmp>`
 * would still read config from the developer's real `~/.aman-agent/`.
 * Recorded as feedback memory `feedback_aman_agent_hermetic_tests.md`.
 */
function configDir(): string {
  return process.env.AMAN_AGENT_HOME || path.join(os.homedir(), ".aman-agent");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): AgentConfig | null {
  const p = configPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as AgentConfig;
    raw.hooks = { ...DEFAULT_HOOKS, ...raw.hooks };
    return raw;
  } catch {
    return null;
  }
}

export function saveConfig(config: AgentConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(
    configPath(),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

export function configExists(): boolean {
  return fs.existsSync(configPath());
}
