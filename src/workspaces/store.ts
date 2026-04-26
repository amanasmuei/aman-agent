// src/workspaces/store.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homeDir } from "../config.js";
import { EMPTY_STORE, type WorkspaceStore } from "./types.js";

/** Absolute path to the workspaces JSON file. */
export function storePath(): string {
  return path.join(homeDir(), "workspaces.json");
}

/**
 * Load the workspace store. Returns EMPTY_STORE on:
 *   - missing file (first run)
 *   - corrupt JSON
 *   - unknown version (forward-compat fallback)
 *
 * Per spec §3.3: never throws; corruption results in empty store + log warn
 * (logging deferred to the caller — store.ts is pure I/O).
 */
export async function loadStore(): Promise<WorkspaceStore> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath(), "utf-8");
  } catch {
    return { ...EMPTY_STORE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_STORE };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    return { ...EMPTY_STORE };
  }
  const candidate = parsed as WorkspaceStore;
  if (!Array.isArray(candidate.workspaces)) {
    return { ...EMPTY_STORE };
  }
  return candidate;
}

/**
 * Atomic save: write to .tmp, then rename. Same pattern as amem stores.
 * Ensures readers never see a partial file.
 */
export async function saveStore(store: WorkspaceStore): Promise<void> {
  const finalPath = storePath();
  const tmpPath = `${finalPath}.tmp`;
  const dir = path.dirname(finalPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmpPath, finalPath);
}
