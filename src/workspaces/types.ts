// src/workspaces/types.ts
/**
 * Workspace tracker — durable memory of which cwds (workspaces) the user
 * has worked in. LRU-capped at 7 (Miller's law) to keep the index human-scale.
 *
 * Per §10 reconciliation: this is the WORKSPACE concept (where I code).
 * The aman-mcp project layer at ~/.aprojects/ tracks THREADS (what I pursue).
 * Threads can span multiple workspaces; workspaces host multiple threads over time.
 */

export interface WorkspaceEntry {
  /** Absolute, canonical (realpath'd) path to git root or cwd */
  path: string;
  /** basename(path) for display */
  name: string;
  /** ISO 8601 of first time this workspace was seen */
  firstSeen: string;
  /** ISO 8601 of most recent record */
  lastSeen: string;
  /** True if pruned out of the active LRU (cap-overflow marker only — NOT memory archival) */
  archived: boolean;
  /** Optional free-form user notes */
  notes?: string;
}

/** Persisted top-level shape — version field is the migration seam. */
export interface WorkspaceStore {
  version: 1;
  workspaces: WorkspaceEntry[];
}

/**
 * Active LRU cap. Miller's law (7 ± 2) keeps the index human-scale.
 * Active workspaces above this count auto-archive the oldest by lastSeen.
 */
export const WORKSPACE_CAP = 7;

/** Empty initial store. */
export const EMPTY_STORE: WorkspaceStore = {
  version: 1,
  workspaces: [],
};
