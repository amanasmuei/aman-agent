// src/workspaces/tracker.ts
import * as fsSync from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
