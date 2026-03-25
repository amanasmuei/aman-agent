import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG_DIR = path.join(os.homedir(), ".aman-agent");
export const LOG_PATH = path.join(LOG_DIR, "debug.log");
const MAX_LOG_SIZE = 1_048_576; // 1MB

interface LogEntry {
  timestamp: string;
  level: "debug" | "warn" | "error";
  module: string;
  message: string;
  data?: string;
}

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function maybeRotate(): void {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const stat = fs.statSync(LOG_PATH);
    if (stat.size >= MAX_LOG_SIZE) {
      const backupPath = LOG_PATH + ".1";
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(LOG_PATH, backupPath);
    }
  } catch {
    // Rotation failure is non-critical
  }
}

function write(level: LogEntry["level"], module: string, message: string, data?: unknown): void {
  try {
    ensureDir();
    maybeRotate();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
    };
    if (data !== undefined) {
      entry.data = data instanceof Error ? data.message : String(data);
    }
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {
    // Logger must never throw
  }
}

export const log = {
  debug: (module: string, message: string, data?: unknown) => write("debug", module, message, data),
  warn: (module: string, message: string, data?: unknown) => write("warn", module, message, data),
  error: (module: string, message: string, data?: unknown) => write("error", module, message, data),
};
