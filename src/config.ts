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

export interface MirrorConfig {
  enabled?: boolean;
  dir?: string;
  tiers?: Array<"core" | "working" | "archival">;
  autoSyncOnStartup?: boolean;
}

const DEFAULT_MIRROR: Required<MirrorConfig> = {
  enabled: true,
  dir: "",  // populated in loadConfig via homeDir() — empty string is a sentinel
  tiers: ["core", "working", "archival"],
  autoSyncOnStartup: true,
};

/**
 * Expand a leading `~/` or bare `~` in a path to the user's home directory.
 * Narrow contract: only expands `~` or `~/...`; `~alice/...` is returned as-is.
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

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
  mirror?: MirrorConfig;
  orchestrator?: {
    maxParallelTasks?: number;
    defaultTier?: "fast" | "standard" | "advanced";
    requireApprovalForPhaseTransition?: boolean;
    taskTimeoutMs?: number;
    orchestrationTimeoutMs?: number;
  };
  github?: {
    defaultRepo?: string;       // owner/repo format
    defaultBranch?: string;     // default: "main"
    autoCreatePR?: boolean;     // auto-create PR after orchestration
    ciGateEnabled?: boolean;    // wait for CI before merging
  };
}

/**
 * Resolve the aman-agent home directory.
 * Priority: $AMAN_HOME > $AMAN_AGENT_HOME > ~/.aman-agent
 *
 * Previously `configDir()` was the sole entry point and only checked
 * `AMAN_AGENT_HOME`. Now `homeDir()` is canonical, and `configDir()`
 * delegates to it.  Recorded as feedback memory
 * `feedback_aman_agent_hermetic_tests.md`.
 */
export function homeDir(): string {
  return process.env.AMAN_HOME || process.env.AMAN_AGENT_HOME || path.join(os.homedir(), ".aman-agent");
}

export function identityDir(): string { return path.join(homeDir(), "identity"); }
export function rulesDir(): string { return path.join(homeDir(), "rules"); }
export function memoryDir(): string { return path.join(homeDir(), "memory"); }
export function workflowsDir(): string { return path.join(homeDir(), "workflows"); }
export function skillsDir(): string { return path.join(homeDir(), "skills"); }
export function evalDir(): string { return path.join(homeDir(), "eval"); }

function configDir(): string {
  return homeDir();
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
    raw.mirror = {
      ...DEFAULT_MIRROR,
      dir: path.join(homeDir(), "memories"),
      ...(raw.mirror ?? {}),
    };
    raw.mirror.dir = expandHome(raw.mirror.dir as string);
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
