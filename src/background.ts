import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import type { McpManager } from "./mcp/client.js";
import { log } from "./logger.js";

export interface BackgroundTask {
  id: string;
  toolName: string;
  toolUseId: string;
  startedAt: number;
  promise: Promise<string>;
  result?: string;
  error?: string;
  done: boolean;
}

// Tools that are likely long-running and benefit from background execution
const BACKGROUND_ELIGIBLE = new Set([
  "run_tests", "npm_test", "build", "npm_build",
  "file_search", "code_search", "grep_search",
  "git_clone", "docker_build", "docker_run",
]);

// Tools that should NEVER run in background (need immediate results for tool loop)
const NEVER_BACKGROUND = new Set([
  "memory_recall", "memory_store", "memory_log", "memory_context", "memory_detail",
  "identity_read", "identity_summary", "identity_update_session", "identity_update_dynamics",
  "rules_check", "rules_list", "workflow_list", "workflow_get",
  "skill_list", "skill_search", "eval_status", "eval_log",
  "reminder_check", "reminder_set",
  "file_read", "doc_convert", "file_list",
  "avatar_prompt",
]);

// ── Persistent task log ────────────────────────────────────────────────────────

export interface TaskLogEntry {
  id: string;
  toolName: string;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "interrupted";
  resultPreview?: string;
  error?: string;
}

const TASK_LOG_DIR = path.join(os.homedir(), ".aman-agent");
const TASK_LOG_FILE = path.join(TASK_LOG_DIR, "bg-tasks.json");
const MAX_LOG_ENTRIES = 50;

export function loadTaskLog(): TaskLogEntry[] {
  try {
    if (!fs.existsSync(TASK_LOG_FILE)) return [];
    const raw = fs.readFileSync(TASK_LOG_FILE, "utf-8");
    return JSON.parse(raw) as TaskLogEntry[];
  } catch {
    return [];
  }
}

export function saveTaskLog(entries: TaskLogEntry[]): void {
  try {
    if (!fs.existsSync(TASK_LOG_DIR)) fs.mkdirSync(TASK_LOG_DIR, { recursive: true });
    // Keep only recent entries
    const trimmed = entries.slice(-MAX_LOG_ENTRIES);
    fs.writeFileSync(TASK_LOG_FILE, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    log.debug("background", "Failed to save task log", err);
  }
}

function logTaskStart(task: BackgroundTask): void {
  const entries = loadTaskLog();
  // Mark any stale "running" entries as interrupted (from prior crash)
  for (const e of entries) {
    if (e.status === "running") e.status = "interrupted";
  }
  entries.push({
    id: task.id,
    toolName: task.toolName,
    startedAt: task.startedAt,
    status: "running",
  });
  saveTaskLog(entries);
}

function logTaskComplete(task: BackgroundTask): void {
  const entries = loadTaskLog();
  const entry = entries.find((e) => e.id === task.id);
  if (entry) {
    entry.completedAt = Date.now();
    entry.status = task.error ? "failed" : "completed";
    entry.resultPreview = (task.result || "").slice(0, 200);
    entry.error = task.error;
  }
  saveTaskLog(entries);
}
export function shouldRunInBackground(toolName: string): boolean {
  if (NEVER_BACKGROUND.has(toolName)) return false;
  if (BACKGROUND_ELIGIBLE.has(toolName)) return true;
  return false;
}

/**
 * Background task manager.
 * Runs tool calls concurrently and reports results when ready.
 */
export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private taskCounter = 0;

  /**
   * Launch a tool call in the background.
   */
  launch(
    toolName: string,
    toolUseId: string,
    mcpManager: McpManager,
    toolInput: Record<string, unknown>,
  ): BackgroundTask {
    const id = `bg-${++this.taskCounter}`;
    const task: BackgroundTask = {
      id,
      toolName,
      toolUseId,
      startedAt: Date.now(),
      done: false,
      promise: mcpManager.callTool(toolName, toolInput).then(
        (result) => {
          task.result = result;
          task.done = true;
          logTaskComplete(task);
          return result;
        },
        (error) => {
          task.error = error instanceof Error ? error.message : String(error);
          task.done = true;
          logTaskComplete(task);
          return `Error: ${task.error}`;
        },
      ),
    };

    this.tasks.set(id, task);
    logTaskStart(task);
    process.stdout.write(pc.dim(`  [${toolName} running in background (${id})...]\n`));
    return task;
  }

  /**
   * Check for completed background tasks and return their results.
   */
  collectCompleted(): BackgroundTask[] {
    const completed: BackgroundTask[] = [];
    for (const [id, task] of this.tasks) {
      if (task.done) {
        completed.push(task);
        this.tasks.delete(id);
      }
    }
    return completed;
  }

  /**
   * Display completed background task results to the user.
   */
  displayCompleted(): string[] {
    const completed = this.collectCompleted();
    const outputs: string[] = [];

    for (const task of completed) {
      const elapsed = ((Date.now() - task.startedAt) / 1000).toFixed(1);
      if (task.error) {
        process.stdout.write(pc.yellow(`\n  [${task.id}] ${task.toolName} failed after ${elapsed}s: ${task.error}\n`));
        outputs.push(`[Background task ${task.toolName} failed: ${task.error}]`);
      } else {
        process.stdout.write(pc.green(`\n  [${task.id}] ${task.toolName} completed in ${elapsed}s\n`));
        const preview = (task.result || "").slice(0, 200);
        if (preview) {
          process.stdout.write(pc.dim(`  ${preview}${(task.result || "").length > 200 ? "..." : ""}\n`));
        }
        outputs.push(`[Background task ${task.toolName} completed: ${task.result}]`);
      }
    }

    return outputs;
  }

  /**
   * Wait for all pending background tasks to complete.
   */
  async waitAll(): Promise<void> {
    const pending = [...this.tasks.values()].filter((t) => !t.done);
    if (pending.length === 0) return;

    process.stdout.write(pc.dim(`\n  Waiting for ${pending.length} background task(s)...\n`));
    await Promise.allSettled(pending.map((t) => t.promise));
  }

  /**
   * Number of currently running tasks.
   */
  get pendingCount(): number {
    return [...this.tasks.values()].filter((t) => !t.done).length;
  }

  /**
   * Check if any tasks have completed (non-blocking).
   */
  get hasCompleted(): boolean {
    return [...this.tasks.values()].some((t) => t.done);
  }
}
