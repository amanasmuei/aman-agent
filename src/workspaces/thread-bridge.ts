// src/workspaces/thread-bridge.ts
/**
 * Per §10.4 of the workspace tracker spec — at runAgent startup, surface
 * the relationship between the current cwd (workspace) and the user's
 * active aman-mcp thread.
 *
 * Reads via MCP — does NOT write. Never auto-creates threads.
 * Graceful degradation: any failure returns null (or a workspace-only
 * message) and logs at warn level.
 */

import { log } from "../logger.js";
import type { McpManager } from "../mcp/client.js";
import { identifyWorkspace } from "./tracker.js";

export interface ThreadSurfaceInput {
  workspaceName: string;
  activeThread: { id: string; name: string; workspaces?: string[] } | null;
  cwdMatchesThreadWorkspaces: boolean;
}

/**
 * Pure formatter — separated from MCP I/O for cheap testing.
 *
 * Three shapes:
 *   - no active thread        -> "Workspace: <name>"
 *   - active + cwd matches    -> "Workspace: <name> — part of active thread \"<thread>\"."
 *   - active + cwd doesn't    -> "Workspace: <name>; current thread \"<thread>\" (different workspace)."
 */
export function formatThreadSurfaceMessage(input: ThreadSurfaceInput): string {
  const { workspaceName, activeThread, cwdMatchesThreadWorkspaces } = input;
  if (!activeThread) {
    return `Workspace: ${workspaceName}`;
  }
  if (cwdMatchesThreadWorkspaces) {
    return `Workspace: ${workspaceName} — part of active thread "${activeThread.name}".`;
  }
  return `Workspace: ${workspaceName}; current thread "${activeThread.name}" (different workspace).`;
}

/**
 * Call mcp__aman__project_active and emit a one-line context message.
 * Always non-fatal; if anything fails or the tool isn't available, returns
 * a workspace-only message (or null if even identifyWorkspace fails).
 */
export async function surfaceCurrentThread(
  cwd: string,
  mcpManager: McpManager,
): Promise<string | null> {
  let workspaceId: { path: string; name: string };
  try {
    workspaceId = await identifyWorkspace(cwd);
  } catch (err) {
    log.warn(
      "workspaces.thread-bridge",
      "identifyWorkspace failed (non-fatal)",
      err,
    );
    return null;
  }

  let activeThread: ThreadSurfaceInput["activeThread"] = null;
  try {
    // McpManager.callTool returns Promise<string>:
    //   - tool's text content (joined) on success
    //   - "Error: tool X not found" / "Error: server Y not connected" on failure
    //   - the literal string "null" if project_active returned no project
    const text = await mcpManager.callTool("project_active", {});
    if (
      typeof text === "string" &&
      text !== "null" &&
      !text.startsWith("Error:")
    ) {
      const parsed = JSON.parse(text);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.id === "string" &&
        typeof parsed.name === "string"
      ) {
        activeThread = {
          id: parsed.id,
          name: parsed.name,
          workspaces: Array.isArray(parsed.workspaces)
            ? parsed.workspaces
            : undefined,
        };
      }
    }
  } catch (err) {
    // JSON.parse failure or unexpected MCP shape — treat as no active thread.
    log.warn(
      "workspaces.thread-bridge",
      "project_active parse failed (non-fatal)",
      err,
    );
  }

  // Match cwd against thread.workspaces[]: either canonical path equality
  // or trailing-name match (~/foo/aman-mcp endsWith "aman-mcp").
  const cwdMatchesThreadWorkspaces =
    activeThread?.workspaces?.some(
      (w) => w === workspaceId.path || w.endsWith(workspaceId.name),
    ) ?? false;

  return formatThreadSurfaceMessage({
    workspaceName: workspaceId.name,
    activeThread,
    cwdMatchesThreadWorkspaces,
  });
}
