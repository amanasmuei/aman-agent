// src/workspaces/tracker.ts
import * as fsSync from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadStore, saveStore } from "./store.js";
import {
  WORKSPACE_CAP,
  type WorkspaceEntry,
  type WorkspaceStore,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface WorkspaceId {
  path: string;
  name: string;
}

/**
 * Resolve the workspace identity for a cwd:
 *   - git repo: use `git rev-parse --show-toplevel` (via execFile, no shell)
 *   - else: absolute (realpath'd) cwd
 *
 * Per §2.1: matches how users think about projects (one repo = one workspace).
 * Sub-directories of a repo all map to the same workspace.
 */
export async function identifyWorkspace(cwd: string): Promise<WorkspaceId> {
  let gitRoot: string | null = null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
    );
    const trimmed = stdout.trim();
    if (trimmed) gitRoot = trimmed;
  } catch {
    // not a git repo; fall through
  }
  const resolved = gitRoot ?? cwd;
  // realpath canonicalizes (resolves symlinks like /var -> /private/var on macOS)
  const canonical = fsSync.realpathSync(resolved);
  return { path: canonical, name: path.basename(canonical) };
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Record (or touch) the workspace for the given cwd.
 * Per §2.2: called from runAgent at startup.
 *
 * Behavior:
 *   - First time seeing this path -> create new entry (firstSeen = lastSeen = now)
 *   - Existing match -> touch lastSeen, set archived = false
 *   - After insert/update, prune LRU: if active count > 7, archive oldest by lastSeen
 */
export async function recordWorkspace(cwd: string): Promise<WorkspaceEntry> {
  const id = await identifyWorkspace(cwd);
  const store = await loadStore();
  const now = nowIso();
  let entry = store.workspaces.find((w) => w.path === id.path);
  if (entry) {
    entry.lastSeen = now;
    entry.archived = false;
  } else {
    entry = {
      path: id.path,
      name: id.name,
      firstSeen: now,
      lastSeen: now,
      archived: false,
    };
    store.workspaces.push(entry);
  }
  pruneLRU(store);
  await saveStore(store);
  return entry;
}

/**
 * Mutates store: if active count > WORKSPACE_CAP, archive oldest active by lastSeen.
 * Archived entries don't count toward the cap.
 */
function pruneLRU(store: WorkspaceStore): void {
  const active = store.workspaces.filter((w) => !w.archived);
  if (active.length <= WORKSPACE_CAP) return;
  const oldest = active.reduce((acc, cur) =>
    new Date(cur.lastSeen).getTime() < new Date(acc.lastSeen).getTime()
      ? cur
      : acc,
  );
  oldest.archived = true;
}
