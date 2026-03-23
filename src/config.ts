import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AgentConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".aman-agent");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): AgentConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
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
