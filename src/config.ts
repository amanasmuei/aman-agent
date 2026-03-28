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

export interface AgentConfig {
  provider: "anthropic" | "openai" | "ollama";
  apiKey: string;
  model: string;
  hooks?: HooksConfig;
  mcpServers?: Record<string, McpServerEntry>;
}

const CONFIG_DIR = path.join(os.homedir(), ".aman-agent");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): AgentConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as AgentConfig;
    raw.hooks = { ...DEFAULT_HOOKS, ...raw.hooks };
    return raw;
  } catch {
    return null;
  }
}

export function saveConfig(config: AgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}
