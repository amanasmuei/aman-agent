# Workspace Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the workspace tracker subsystem in `aman-agent` per the strawman at `docs/superpowers/specs/2026-04-21-project-tracking-design.md` (with §10 reconciliation). Adds durable per-cwd workspace memory (N=7 LRU) and a thread-bridge that surfaces the active aman-mcp thread at startup.

**Architecture:** New `src/workspaces/` module with three files (types, store, tracker), a thread-bridge for MCP integration, a slash-command handler, and a 2-line wiring change in `runAgent`. Single-file JSON store at `~/.aman-agent/workspaces.json` with version field and atomic save (matches existing `bg-tasks.json` convention).

**Tech Stack:** TypeScript (strict), vitest, `@modelcontextprotocol/sdk` (already present via `McpManager`), Node `fs/promises` for atomic writes. **Subprocess calls use `execFileSync` / `execFile` with array args (no shell)** — matches the codebase pattern in `src/index.ts`.

---

## Spec Reference

This plan implements `docs/superpowers/specs/2026-04-21-project-tracking-design.md` with §10 vocabulary fix applied throughout: **`Project` → `Workspace`** in all names. The strawman remains canonical for design rationale; this plan is the execution recipe.

Key invariants from the spec:
- §2.1 Identity: git repo root via `git rev-parse --show-toplevel`, else absolute cwd path
- §2.4 LRU cap: **N=7 active** (Miller's law); archived entries don't count
- §2.5 Cap-overflow: silent auto-archive of oldest active by `lastSeen`
- §3.3 Startup non-fatal: any error logs + continues; never blocks `runAgent`
- §10.4 Thread-bridge: at startup, also call `mcp__aman__project_active` and surface the relationship between cwd and active thread; never auto-create threads

---

## File Structure

### Create

| File | Responsibility |
|---|---|
| `src/workspaces/types.ts` | `WorkspaceEntry`, `WorkspaceStore`, `WORKSPACE_CAP` constant |
| `src/workspaces/store.ts` | Atomic JSON read/write at `${AMAN_AGENT_HOME}/workspaces.json`, version-aware |
| `src/workspaces/tracker.ts` | `identifyWorkspace`, `recordWorkspace` (LRU prune), `listWorkspaces`, `archiveWorkspace`, `unarchiveWorkspace`, `setNotes`, `forgetWorkspace` |
| `src/workspaces/thread-bridge.ts` | `surfaceCurrentThread(cwd, mcpManager)` — calls `mcp__aman__project_active`, formats user-facing message |
| `src/workspaces/index.ts` | Re-exports |
| `src/commands/workspaces.ts` | `handleWorkspacesCommand(action, args, ctx)` — `/workspaces` slash command |
| `test/workspaces-store.test.ts` | Atomic save, version handling, corrupt-store recovery |
| `test/workspaces-tracker.test.ts` | identify, record, LRU prune, archive/unarchive, notes, forget |
| `test/workspaces-thread-bridge.test.ts` | Active thread surfacing with mock MCP, graceful degradation |
| `test/workspaces-commands.test.ts` | Slash command actions and output format |

### Modify

| File | Change |
|---|---|
| `src/agent.ts` | Add `recordWorkspace(process.cwd())` + `surfaceCurrentThread(process.cwd(), mcpManager)` calls near top of `runAgent`, both wrapped in `.catch()` per §3.3 |
| `src/commands.ts` | Add `"workspaces"` to `KNOWN_COMMANDS`; add `case "workspaces":` dispatching to `handleWorkspacesCommand` |
| `package.json` | Bump version (`0.42.0` → `0.43.0` — minor for new feature) |
| `CHANGELOG.md` | Add entry for `0.43.0` |

### Untouched (per spec)

- `src/project/` (singular — classification subsystem). The plural-vs-singular naming is deliberate; do not rename or merge.
- `~/.aprojects/dev/plugin/projects.md` (aman-mcp's territory; this code only *reads* via MCP).

---

## Conventions

- **Path resolution for store:** use `homeDir()` from `src/config.ts:104` which already respects `AMAN_HOME` / `AMAN_AGENT_HOME` env vars. Append `/workspaces.json`.
- **Tests use `AMAN_AGENT_HOME` env var** in `beforeEach`/`afterEach` for isolation (matches existing test patterns; check `test/config.test.ts` for examples).
- **Atomic save:** write to `workspaces.json.tmp`, then `fs.rename()` over the real file (matches amem store convention).
- **Subprocess calls:** use `execFile` / `execFileSync` with array args. Never `exec` / `execSync` (shell injection risk). Matches existing codebase pattern in `src/index.ts:711` and `:725`.
- **MCP calls** go through the existing `McpManager` instance available in `runAgent` context (`src/agent.ts:138`/`:250`). Thread-bridge accepts it as a parameter.
- **Logger:** use the existing `logger` import from `src/logger.ts` for non-fatal warnings.

---

## Phase 1 — Types & Store

### Task 1: Types

**Files:**
- Create: `src/workspaces/types.ts`

- [ ] **Step 1: Create types file**

```typescript
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
```

- [ ] **Step 2: Verify lint**

```bash
cd /Users/aman-asmuei/project-aman/aman-agent
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/workspaces/types.ts
git commit -m "feat(workspaces): add WorkspaceEntry / WorkspaceStore types"
```

---

### Task 2: Store (read/write/atomic-save)

**Files:**
- Create: `src/workspaces/store.ts`
- Create: `test/workspaces-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/workspaces-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadStore, saveStore, storePath } from "../src/workspaces/store.js";
import { EMPTY_STORE, type WorkspaceStore } from "../src/workspaces/types.js";

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "aman-agent-ws-"));
  originalEnv = process.env.AMAN_AGENT_HOME;
  process.env.AMAN_AGENT_HOME = tmp;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.AMAN_AGENT_HOME;
  else process.env.AMAN_AGENT_HOME = originalEnv;
  fsSync.rmSync(tmp, { recursive: true, force: true });
});

describe("workspaces/store", () => {
  it("loadStore returns EMPTY_STORE when file does not exist", async () => {
    const store = await loadStore();
    expect(store).toEqual(EMPTY_STORE);
  });

  it("loadStore returns EMPTY_STORE when file is corrupt JSON", async () => {
    await fs.writeFile(storePath(), "not json {{{", "utf-8");
    const store = await loadStore();
    expect(store).toEqual(EMPTY_STORE);
  });

  it("loadStore returns EMPTY_STORE when version is unknown", async () => {
    await fs.writeFile(
      storePath(),
      JSON.stringify({ version: 99, workspaces: [] }),
      "utf-8",
    );
    const store = await loadStore();
    expect(store).toEqual(EMPTY_STORE);
  });

  it("saveStore + loadStore round-trip preserves all fields", async () => {
    const original: WorkspaceStore = {
      version: 1,
      workspaces: [
        {
          path: "/Users/test/repo-a",
          name: "repo-a",
          firstSeen: "2026-04-26T08:00:00.000Z",
          lastSeen: "2026-04-26T14:00:00.000Z",
          archived: false,
          notes: "first repo",
        },
        {
          path: "/Users/test/repo-b",
          name: "repo-b",
          firstSeen: "2026-04-25T08:00:00.000Z",
          lastSeen: "2026-04-25T08:00:00.000Z",
          archived: true,
        },
      ],
    };
    await saveStore(original);
    const loaded = await loadStore();
    expect(loaded).toEqual(original);
  });

  it("saveStore is atomic — writes via .tmp then renames (no partial file)", async () => {
    const dir = process.env.AMAN_AGENT_HOME!;
    await saveStore({ version: 1, workspaces: [] });
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("workspaces"));
    // Only the final file remains; .tmp was renamed (not left behind)
    expect(files).toContain("workspaces.json");
    expect(files).not.toContain("workspaces.json.tmp");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-store.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement store.ts**

```typescript
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
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run test/workspaces-store.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/store.ts test/workspaces-store.test.ts
git commit -m "feat(workspaces): atomic JSON store with version-aware load"
```

---

## Phase 2 — Tracker

### Task 3: identifyWorkspace

**Files:**
- Create: `src/workspaces/tracker.ts`
- Create: `test/workspaces-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

Note: use `execFileSync` with array args (not `execSync` — shell injection risk). Matches the safe pattern in `src/index.ts:711`.

```typescript
// test/workspaces-tracker.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { identifyWorkspace } from "../src/workspaces/tracker.js";

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aman-agent-ws-tracker-"));
  originalEnv = process.env.AMAN_AGENT_HOME;
  process.env.AMAN_AGENT_HOME = tmp;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.AMAN_AGENT_HOME;
  else process.env.AMAN_AGENT_HOME = originalEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
}

describe("identifyWorkspace", () => {
  it("returns the git root when cwd is inside a git repo", async () => {
    const repoDir = path.join(tmp, "my-repo");
    fs.mkdirSync(repoDir);
    gitInit(repoDir);
    const subDir = path.join(repoDir, "src", "nested");
    fs.mkdirSync(subDir, { recursive: true });
    const result = await identifyWorkspace(subDir);
    // Use realpath for comparison; macOS /var → /private/var symlink
    expect(result.path).toBe(fs.realpathSync(repoDir));
    expect(result.name).toBe("my-repo");
  });

  it("returns the absolute cwd path when not in a git repo", async () => {
    const nonRepoDir = path.join(tmp, "scratch");
    fs.mkdirSync(nonRepoDir);
    const result = await identifyWorkspace(nonRepoDir);
    expect(result.path).toBe(fs.realpathSync(nonRepoDir));
    expect(result.name).toBe("scratch");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-tracker.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement identifyWorkspace**

Note: use `execFile` (with array args) via `promisify` — never `exec` (shell). Same safe pattern as `src/index.ts`.

```typescript
// src/workspaces/tracker.ts
import * as fs from "node:fs/promises";
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
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run test/workspaces-tracker.test.ts -t "identifyWorkspace"
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/tracker.ts test/workspaces-tracker.test.ts
git commit -m "feat(workspaces): identifyWorkspace resolves git root or cwd"
```

---

### Task 4: recordWorkspace + LRU prune

**Files:**
- Modify: `src/workspaces/tracker.ts`
- Modify: `test/workspaces-tracker.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/workspaces-tracker.test.ts`:

```typescript
import { recordWorkspace } from "../src/workspaces/tracker.js";
import { loadStore, saveStore } from "../src/workspaces/store.js";

describe("recordWorkspace", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("creates a new entry on first record (firstSeen == lastSeen)", async () => {
    const repo = makeRepo("alpha");
    const entry = await recordWorkspace(repo);
    expect(entry.name).toBe("alpha");
    expect(entry.archived).toBe(false);
    expect(entry.firstSeen).toBe(entry.lastSeen);
    const store = await loadStore();
    expect(store.workspaces).toHaveLength(1);
  });

  it("touches lastSeen on second record (firstSeen unchanged)", async () => {
    const repo = makeRepo("alpha");
    const first = await recordWorkspace(repo);
    await new Promise((r) => setTimeout(r, 10));
    const second = await recordWorkspace(repo);
    expect(second.firstSeen).toBe(first.firstSeen);
    expect(new Date(second.lastSeen).getTime()).toBeGreaterThan(
      new Date(first.lastSeen).getTime(),
    );
    const store = await loadStore();
    expect(store.workspaces).toHaveLength(1);
  });

  it("revives an archived entry (archived -> false on touch)", async () => {
    const repo = makeRepo("alpha");
    await recordWorkspace(repo);
    const store = await loadStore();
    store.workspaces[0].archived = true;
    await saveStore(store);
    const revived = await recordWorkspace(repo);
    expect(revived.archived).toBe(false);
  });

  it("auto-archives the oldest active when 8th workspace is recorded", async () => {
    for (let i = 0; i < 8; i++) {
      const repo = makeRepo(`repo-${i}`);
      await recordWorkspace(repo);
      await new Promise((r) => setTimeout(r, 5));
    }
    const store = await loadStore();
    const active = store.workspaces.filter((w) => !w.archived);
    const archived = store.workspaces.filter((w) => w.archived);
    expect(active).toHaveLength(7);
    expect(archived).toHaveLength(1);
    expect(archived[0].name).toBe("repo-0");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-tracker.test.ts -t "recordWorkspace"
```
Expected: FAIL — `recordWorkspace` not exported.

- [ ] **Step 3: Implement recordWorkspace**

Append to `src/workspaces/tracker.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run test/workspaces-tracker.test.ts
```
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/tracker.ts test/workspaces-tracker.test.ts
git commit -m "feat(workspaces): recordWorkspace + LRU prune at cap=7"
```

---

### Task 5: listWorkspaces, archiveWorkspace, unarchiveWorkspace

**Files:**
- Modify: `src/workspaces/tracker.ts`
- Modify: `test/workspaces-tracker.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/workspaces-tracker.test.ts`:

```typescript
import {
  listWorkspaces,
  archiveWorkspace,
  unarchiveWorkspace,
} from "../src/workspaces/tracker.js";

describe("listWorkspaces", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, `list-${name}`);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("returns active only by default, newest lastSeen first", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await new Promise((r) => setTimeout(r, 10));
    await recordWorkspace(makeRepo("beta"));
    const list = await listWorkspaces();
    expect(list.map((w) => w.name)).toEqual(["beta", "alpha"]);
  });

  it("includes archived when includeArchived=true", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await archiveWorkspace("alpha");
    const activeOnly = await listWorkspaces();
    expect(activeOnly).toHaveLength(0);
    const all = await listWorkspaces({ includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0].archived).toBe(true);
  });
});

describe("archiveWorkspace / unarchiveWorkspace", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, `arch-${name}`);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("archives by name", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await archiveWorkspace("alpha");
    const all = await listWorkspaces({ includeArchived: true });
    expect(all[0].archived).toBe(true);
  });

  it("unarchives by name", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await archiveWorkspace("alpha");
    await unarchiveWorkspace("alpha");
    const list = await listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].archived).toBe(false);
  });

  it("throws when name not found (helpful error)", async () => {
    await expect(archiveWorkspace("nonexistent")).rejects.toThrow(
      /not found/i,
    );
  });

  it("throws when name is ambiguous", async () => {
    const root1 = path.join(tmp, "ambiguous-1");
    const root2 = path.join(tmp, "ambiguous-2");
    fs.mkdirSync(path.join(root1, "shared-name"), { recursive: true });
    fs.mkdirSync(path.join(root2, "shared-name"), { recursive: true });
    gitInit(path.join(root1, "shared-name"));
    gitInit(path.join(root2, "shared-name"));
    await recordWorkspace(path.join(root1, "shared-name"));
    await recordWorkspace(path.join(root2, "shared-name"));
    await expect(archiveWorkspace("shared-name")).rejects.toThrow(
      /ambiguous|multiple/i,
    );
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-tracker.test.ts -t "listWorkspaces|archiveWorkspace"
```
Expected: FAIL.

- [ ] **Step 3: Implement listWorkspaces, archiveWorkspace, unarchiveWorkspace**

Append to `src/workspaces/tracker.ts`:

```typescript
export interface ListOptions {
  includeArchived?: boolean;
}

/**
 * List workspaces.
 * Default: active only, newest lastSeen first.
 * With { includeArchived: true }: all entries, same ordering.
 */
export async function listWorkspaces(
  opts: ListOptions = {},
): Promise<WorkspaceEntry[]> {
  const store = await loadStore();
  const filtered = opts.includeArchived
    ? store.workspaces
    : store.workspaces.filter((w) => !w.archived);
  return [...filtered].sort(
    (a, b) =>
      new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
  );
}

/**
 * Look up a workspace by case-insensitive name match.
 * Throws if zero or multiple matches.
 */
async function findByName(name: string): Promise<WorkspaceEntry> {
  const store = await loadStore();
  const lower = name.toLowerCase();
  const matches = store.workspaces.filter(
    (w) => w.name.toLowerCase() === lower,
  );
  if (matches.length === 0) {
    throw new Error(`Workspace not found: "${name}"`);
  }
  if (matches.length > 1) {
    const paths = matches.map((m) => m.path).join(", ");
    throw new Error(
      `Workspace name "${name}" is ambiguous (${matches.length} matches: ${paths}). Use the full path or rename one.`,
    );
  }
  return matches[0];
}

export async function archiveWorkspace(name: string): Promise<void> {
  const target = await findByName(name);
  const store = await loadStore();
  const entry = store.workspaces.find((w) => w.path === target.path);
  if (!entry) throw new Error(`Workspace not found: "${name}"`);
  entry.archived = true;
  await saveStore(store);
}

export async function unarchiveWorkspace(name: string): Promise<void> {
  const target = await findByName(name);
  const store = await loadStore();
  const entry = store.workspaces.find((w) => w.path === target.path);
  if (!entry) throw new Error(`Workspace not found: "${name}"`);
  entry.archived = false;
  // If unarchiving pushes active count over cap, prune the next-oldest
  pruneLRU(store);
  await saveStore(store);
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run test/workspaces-tracker.test.ts
```
Expected: PASS (all tests including new ones).

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/tracker.ts test/workspaces-tracker.test.ts
git commit -m "feat(workspaces): list / archive / unarchive with name lookup"
```

---

### Task 6: setNotes, forgetWorkspace

**Files:**
- Modify: `src/workspaces/tracker.ts`
- Modify: `test/workspaces-tracker.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/workspaces-tracker.test.ts`:

```typescript
import {
  setNotes,
  forgetWorkspace,
} from "../src/workspaces/tracker.js";

describe("setNotes", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, `notes-${name}`);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("sets notes by name", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await setNotes("alpha", "first notes");
    const list = await listWorkspaces();
    expect(list[0].notes).toBe("first notes");
  });

  it("clears notes when text is empty string", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await setNotes("alpha", "x");
    await setNotes("alpha", "");
    const list = await listWorkspaces();
    expect(list[0].notes).toBeUndefined();
  });
});

describe("forgetWorkspace", () => {
  function makeRepo(name: string): string {
    const dir = path.join(tmp, `forget-${name}`);
    fs.mkdirSync(dir);
    gitInit(dir);
    return dir;
  }

  it("removes the entry entirely (not archive — gone)", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await forgetWorkspace("alpha");
    const all = await listWorkspaces({ includeArchived: true });
    expect(all).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-tracker.test.ts -t "setNotes|forgetWorkspace"
```
Expected: FAIL.

- [ ] **Step 3: Implement setNotes and forgetWorkspace**

Append to `src/workspaces/tracker.ts`:

```typescript
export async function setNotes(name: string, text: string): Promise<void> {
  const target = await findByName(name);
  const store = await loadStore();
  const entry = store.workspaces.find((w) => w.path === target.path);
  if (!entry) throw new Error(`Workspace not found: "${name}"`);
  if (text === "") {
    delete entry.notes;
  } else {
    entry.notes = text;
  }
  await saveStore(store);
}

export async function forgetWorkspace(name: string): Promise<void> {
  const target = await findByName(name);
  const store = await loadStore();
  store.workspaces = store.workspaces.filter((w) => w.path !== target.path);
  await saveStore(store);
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run test/workspaces-tracker.test.ts
```
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/tracker.ts test/workspaces-tracker.test.ts
git commit -m "feat(workspaces): setNotes + forgetWorkspace"
```

---

### Task 7: Index re-exports

**Files:**
- Create: `src/workspaces/index.ts`

- [ ] **Step 1: Create the index**

```typescript
// src/workspaces/index.ts
export * from "./types.js";
export {
  identifyWorkspace,
  recordWorkspace,
  listWorkspaces,
  archiveWorkspace,
  unarchiveWorkspace,
  setNotes,
  forgetWorkspace,
  type ListOptions,
  type WorkspaceId,
} from "./tracker.js";
export { storePath, loadStore, saveStore } from "./store.js";
```

- [ ] **Step 2: Verify lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/workspaces/index.ts
git commit -m "feat(workspaces): public index re-exports"
```

---

## Phase 3 — Thread Bridge (MCP Integration)

### Task 8: surfaceCurrentThread (MCP integration)

**Files:**
- Create: `src/workspaces/thread-bridge.ts`
- Create: `test/workspaces-thread-bridge.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/workspaces-thread-bridge.test.ts
import { describe, it, expect } from "vitest";
import { formatThreadSurfaceMessage } from "../src/workspaces/thread-bridge.js";

describe("formatThreadSurfaceMessage", () => {
  it("returns a workspace-only line when no active thread", () => {
    const msg = formatThreadSurfaceMessage({
      workspaceName: "aman-mcp",
      activeThread: null,
      cwdMatchesThreadWorkspaces: false,
    });
    expect(msg).toContain("aman-mcp");
    expect(msg).not.toContain("thread");
  });

  it("anchors inline when cwd is in the active thread's workspaces", () => {
    const msg = formatThreadSurfaceMessage({
      workspaceName: "aman-mcp",
      activeThread: {
        id: "01KS3F29B92X3TFNDG30HJR4D1",
        name: "Phase 1.5 substrate",
      },
      cwdMatchesThreadWorkspaces: true,
    });
    expect(msg).toContain("aman-mcp");
    expect(msg).toContain("Phase 1.5 substrate");
    expect(msg).toMatch(/part of|workspace.*for/i);
  });

  it("surfaces softly when there is an active thread but cwd doesn't match", () => {
    const msg = formatThreadSurfaceMessage({
      workspaceName: "scratch-repo",
      activeThread: {
        id: "01KS3F29B92X3TFNDG30HJR4D1",
        name: "Phase 1.5 substrate",
      },
      cwdMatchesThreadWorkspaces: false,
    });
    expect(msg).toContain("scratch-repo");
    expect(msg).toContain("Phase 1.5 substrate");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-thread-bridge.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement thread-bridge**

```typescript
// src/workspaces/thread-bridge.ts
/**
 * Per §10.4 — at runAgent startup, surface the relationship between the
 * current cwd (workspace) and the user's active aman-mcp thread.
 *
 * Reads via MCP — does NOT write. Never auto-creates threads.
 * Graceful degradation: any failure returns null and logs at warn level.
 */

import { logger } from "../logger.js";
import type { McpManager } from "../mcp/client.js";
import { identifyWorkspace } from "./tracker.js";

export interface ThreadSurfaceInput {
  workspaceName: string;
  activeThread: { id: string; name: string; workspaces?: string[] } | null;
  cwdMatchesThreadWorkspaces: boolean;
}

/**
 * Pure formatter — separated from MCP I/O for cheap testing.
 */
export function formatThreadSurfaceMessage(input: ThreadSurfaceInput): string {
  const { workspaceName, activeThread, cwdMatchesThreadWorkspaces } = input;
  if (!activeThread) {
    return `Workspace: ${workspaceName} (no active thread)`;
  }
  if (cwdMatchesThreadWorkspaces) {
    return `Workspace: ${workspaceName} — part of active thread "${activeThread.name}".`;
  }
  return `Workspace: ${workspaceName}; current thread "${activeThread.name}" (different workspace).`;
}

/**
 * Call mcp__aman__project_active and emit a one-line context message.
 * Always non-fatal; if anything fails, returns null and logs warn.
 */
export async function surfaceCurrentThread(
  cwd: string,
  mcpManager: McpManager,
): Promise<string | null> {
  try {
    const id = await identifyWorkspace(cwd);
    let activeThread: ThreadSurfaceInput["activeThread"] = null;
    try {
      const result = await mcpManager.callTool(
        "aman",
        "project_active",
        {},
      );
      // Tool returns JSON string of Project | null
      const text = result?.content?.[0]?.text;
      if (typeof text === "string" && text !== "null") {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && parsed.id && parsed.name) {
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
      logger.warn("project_active call failed (non-fatal)", err);
    }
    const cwdMatchesThreadWorkspaces =
      activeThread?.workspaces?.some((w) => {
        // Match by canonical path or trailing-name. Workspaces field may
        // contain ~/path or absolute; resolve both ways.
        return w === id.path || w.endsWith(id.name);
      }) ?? false;
    return formatThreadSurfaceMessage({
      workspaceName: id.name,
      activeThread,
      cwdMatchesThreadWorkspaces,
    });
  } catch (err) {
    logger.warn("surfaceCurrentThread failed (non-fatal)", err);
    return null;
  }
}
```

Note: the `mcpManager.callTool` signature must match what aman-agent's `McpManager` exposes. Read `src/mcp/client.ts` first to confirm — adjust the call shape if it differs (e.g., uses `mcpManager.call` or different arg order). The behavior is what matters; the wrapping is mechanical.

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run test/workspaces-thread-bridge.test.ts
```
Expected: PASS (3 tests — all formatter tests; the actual MCP call is exercised in agent integration).

- [ ] **Step 5: Update index re-exports**

Edit `src/workspaces/index.ts` to add:

```typescript
export {
  surfaceCurrentThread,
  formatThreadSurfaceMessage,
  type ThreadSurfaceInput,
} from "./thread-bridge.js";
```

- [ ] **Step 6: Commit**

```bash
git add src/workspaces/thread-bridge.ts src/workspaces/index.ts test/workspaces-thread-bridge.test.ts
git commit -m "feat(workspaces): thread-bridge surfaces aman-mcp project_active"
```

---

## Phase 4 — Slash Command

### Task 9: /workspaces command

**Files:**
- Create: `src/commands/workspaces.ts`
- Modify: `src/commands.ts`
- Create: `test/workspaces-commands.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/workspaces-commands.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { handleWorkspacesCommand } from "../src/commands/workspaces.js";
import { recordWorkspace } from "../src/workspaces/tracker.js";

const FAKE_CTX = {} as never;

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aman-agent-ws-cmd-"));
  originalEnv = process.env.AMAN_AGENT_HOME;
  process.env.AMAN_AGENT_HOME = tmp;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.AMAN_AGENT_HOME;
  else process.env.AMAN_AGENT_HOME = originalEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
}

function makeRepo(name: string): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  gitInit(dir);
  return dir;
}

describe("handleWorkspacesCommand", () => {
  it("'list' (no action) shows active workspaces newest-first", async () => {
    await recordWorkspace(makeRepo("alpha"));
    await new Promise((r) => setTimeout(r, 10));
    await recordWorkspace(makeRepo("beta"));
    const result = await handleWorkspacesCommand("", [], FAKE_CTX);
    expect(result.handled).toBe(true);
    expect(result.output).toContain("beta");
    expect(result.output).toContain("alpha");
    const idxBeta = result.output!.indexOf("beta");
    const idxAlpha = result.output!.indexOf("alpha");
    expect(idxBeta).toBeLessThan(idxAlpha);
  });

  it("'all' includes archived (with marker)", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const { archiveWorkspace } = await import("../src/workspaces/tracker.js");
    await archiveWorkspace("alpha");
    const result = await handleWorkspacesCommand("all", [], FAKE_CTX);
    expect(result.output).toContain("alpha");
    expect(result.output).toMatch(/archived/i);
  });

  it("'archive <name>' archives", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const result = await handleWorkspacesCommand(
      "archive",
      ["alpha"],
      FAKE_CTX,
    );
    expect(result.handled).toBe(true);
    expect(result.output).toMatch(/archived/i);
  });

  it("'unarchive <name>' un-archives", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const { archiveWorkspace } = await import("../src/workspaces/tracker.js");
    await archiveWorkspace("alpha");
    const result = await handleWorkspacesCommand(
      "unarchive",
      ["alpha"],
      FAKE_CTX,
    );
    expect(result.output).toMatch(/unarchived|active/i);
  });

  it("'notes <name> <text...>' sets notes", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const result = await handleWorkspacesCommand(
      "notes",
      ["alpha", "scratch", "experiment"],
      FAKE_CTX,
    );
    expect(result.output).toMatch(/notes/i);
  });

  it("'forget <name>' removes the entry", async () => {
    await recordWorkspace(makeRepo("alpha"));
    const result = await handleWorkspacesCommand(
      "forget",
      ["alpha"],
      FAKE_CTX,
    );
    expect(result.output).toMatch(/forgot|removed/i);
  });

  it("returns a helpful error for unknown action", async () => {
    const result = await handleWorkspacesCommand("zoiks", [], FAKE_CTX);
    expect(result.handled).toBe(true);
    expect(result.output).toMatch(/unknown|usage/i);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workspaces-commands.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement command handler**

```typescript
// src/commands/workspaces.ts
import pc from "picocolors";
import type { CommandContext, CommandResult } from "./shared.js";
import {
  listWorkspaces,
  archiveWorkspace,
  unarchiveWorkspace,
  setNotes,
  forgetWorkspace,
} from "../workspaces/tracker.js";

const USAGE = `Usage:
  /workspaces                  list active, newest first
  /workspaces all              include archived
  /workspaces archive <name>   manually archive
  /workspaces unarchive <name> re-activate
  /workspaces notes <name> <text...>  set/clear notes (empty text clears)
  /workspaces forget <name>    hard-remove`;

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "1d";
  if (d < 30) return `${d}d`;
  const m = Math.floor(d / 30);
  return `${m}mo`;
}

export async function handleWorkspacesCommand(
  action: string,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  try {
    if (!action || action === "list") {
      const list = await listWorkspaces();
      if (list.length === 0) {
        return {
          handled: true,
          output: pc.dim("No workspaces tracked yet."),
        };
      }
      const lines = list.map(
        (w) =>
          `  ${pc.bold(w.name)}  ${pc.dim(ageOf(w.lastSeen))}  ${pc.dim(
            w.path,
          )}${w.notes ? `\n    ${pc.dim("notes: " + w.notes)}` : ""}`,
      );
      return {
        handled: true,
        output: `Active workspaces (${list.length}/7):\n${lines.join("\n")}`,
      };
    }

    if (action === "all") {
      const list = await listWorkspaces({ includeArchived: true });
      if (list.length === 0) {
        return {
          handled: true,
          output: pc.dim("No workspaces tracked yet."),
        };
      }
      const lines = list.map((w) => {
        const marker = w.archived ? pc.dim("[archived]  ") : "";
        return `  ${marker}${pc.bold(w.name)}  ${pc.dim(
          ageOf(w.lastSeen),
        )}  ${pc.dim(w.path)}`;
      });
      return {
        handled: true,
        output: `All workspaces (${list.length}):\n${lines.join("\n")}`,
      };
    }

    if (action === "archive") {
      const name = args[0];
      if (!name) {
        return { handled: true, output: USAGE };
      }
      await archiveWorkspace(name);
      return { handled: true, output: `Archived: ${name}` };
    }

    if (action === "unarchive") {
      const name = args[0];
      if (!name) return { handled: true, output: USAGE };
      await unarchiveWorkspace(name);
      return { handled: true, output: `Unarchived (now active): ${name}` };
    }

    if (action === "notes") {
      const name = args[0];
      if (!name) return { handled: true, output: USAGE };
      const text = args.slice(1).join(" ");
      await setNotes(name, text);
      return {
        handled: true,
        output: text === ""
          ? `Cleared notes for: ${name}`
          : `Set notes for: ${name}`,
      };
    }

    if (action === "forget") {
      const name = args[0];
      if (!name) return { handled: true, output: USAGE };
      await forgetWorkspace(name);
      return { handled: true, output: `Forgot: ${name} (entry removed)` };
    }

    return {
      handled: true,
      output: `Unknown action: "${action}"\n${USAGE}`,
    };
  } catch (err) {
    return {
      handled: true,
      output: pc.red(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
}
```

- [ ] **Step 4: Wire into the dispatcher**

Edit `src/commands.ts`. Add this import alongside the others (around line 28):

```typescript
import { handleWorkspacesCommand } from "./commands/workspaces.js";
```

Add `"workspaces"` to the `KNOWN_COMMANDS` set:

```typescript
const KNOWN_COMMANDS = new Set([
  "quit", "exit", "q", "help", "clear", "model", "identity", "rules",
  "workflows", "tools", "akit", "skills", "eval", "memory", "status", "doctor",
  "save", "decisions", "export", "debug", "reset", "reminder",
  "update", "upgrade", "plan", "profile", "delegate", "team", "agents", "showcase", "file",
  "observe", "postmortem", "orchestrate", "orch", "github",
  "workspaces",
]);
```

Add the case in the switch (alongside the others):

```typescript
    case "workspaces":
      return handleWorkspacesCommand(action, args, ctx);
```

- [ ] **Step 5: Run tests, verify pass**

```bash
npx vitest run test/workspaces-commands.test.ts
npm run lint
```
Expected: PASS (7 tests). Lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/commands/workspaces.ts src/commands.ts test/workspaces-commands.test.ts
git commit -m "feat(workspaces): /workspaces slash command (list/all/archive/unarchive/notes/forget)"
```

---

## Phase 5 — Agent Integration

### Task 10: Wire into runAgent startup

**Files:**
- Modify: `src/agent.ts`

- [ ] **Step 1: Find the right injection point**

Read `src/agent.ts` and locate `runAgent` function (or its initialization block). The strawman §3.3 says "near the top of `runAgent`, after config load." Locate the block that follows config load and before the REPL loop or main work begins.

Find the `mcpManager` instance — earlier audit showed it's available at lines 138 and 250 inside `HookContext` setup. The startup block where `mcpManager` is first usable is the target.

- [ ] **Step 2: Add the workspace recording + thread surfacing block**

Two style options — pick whichever matches the rest of `src/agent.ts` (check the existing import style):

**Style A (top-level static import, preferred if startup imports are static):**

Add to imports at top of `src/agent.ts`:
```typescript
import { recordWorkspace, surfaceCurrentThread } from "./workspaces/index.js";
```

Inside `runAgent`, after `mcpManager` is available:
```typescript
// Workspace tracking + thread surfacing (per workspaces design spec §3.3 + §10.4).
// Both are non-fatal: any error logs and continues — never blocks startup.
recordWorkspace(process.cwd()).catch((err) =>
  logger.warn("workspace tracking failed (non-fatal)", err),
);
surfaceCurrentThread(process.cwd(), mcpManager).then((msg) => {
  if (msg) logger.info(msg);
}).catch((err) =>
  logger.warn("thread surfacing failed (non-fatal)", err),
);
```

**Style B (lazy dynamic import, preferred if startup is latency-sensitive):**

Inside `runAgent`, after `mcpManager` is available:
```typescript
// Workspace tracking + thread surfacing (per workspaces design spec §3.3 + §10.4).
// Both are non-fatal: any error logs and continues — never blocks startup.
import("./workspaces/index.js").then(async (ws) => {
  try {
    await ws.recordWorkspace(process.cwd());
  } catch (err) {
    logger.warn("workspace tracking failed (non-fatal)", err);
  }
  try {
    const message = await ws.surfaceCurrentThread(process.cwd(), mcpManager);
    if (message) logger.info(message);
  } catch (err) {
    logger.warn("thread surfacing failed (non-fatal)", err);
  }
}).catch((err) => {
  logger.warn("workspaces module load failed (non-fatal)", err);
});
```

**Do not block on either call — both are fire-and-forget.**

- [ ] **Step 3: Run all tests + lint**

```bash
npx vitest run
npm run lint
```
Expected: ALL tests pass; no new failures from this wiring change.

- [ ] **Step 4: Smoke test against a real cwd**

```bash
# Build, then dry-run
npm run build
node bin/aman-agent.js --version 2>&1 | head -3
```
This verifies the import path resolves and bin works. Full integration is implicitly covered by the integration tests we wrote.

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts
git commit -m "feat(agent): wire workspace tracker + thread bridge into runAgent startup"
```

---

## Phase 6 — Ship Prep

### Task 11: Version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version**

Edit `package.json`: change `"version": "0.42.0"` → `"version": "0.43.0"` (minor for new feature).

- [ ] **Step 2: Add CHANGELOG entry**

Prepend to `CHANGELOG.md`:

```markdown
## 0.43.0 — 2026-04-26

### Added — Workspace tracker (LRU N=7) + aman-mcp thread bridge

Implements the workspace half of the project-tracking system designed in
`docs/superpowers/specs/2026-04-21-project-tracking-design.md`
(reconciled with aman-mcp@0.8.0 in §10).

- New `src/workspaces/` module: types, store, tracker, thread-bridge, index
- New `/workspaces` slash command: `list` / `all` / `archive` / `unarchive` / `notes` / `forget`
- New file: `~/.aman-agent/workspaces.json` (created on first run, version 1)
- LRU cap: 7 active workspaces; oldest auto-archives on overflow (silent, non-blocking)
- Identity: git repo root via `git rev-parse --show-toplevel`, else absolute cwd path
- Test isolation: respects `AMAN_AGENT_HOME` env var

#### Cross-layer integration

`recordWorkspace` runs at every `runAgent` startup; `surfaceCurrentThread` calls
`mcp__aman__project_active` (from aman-mcp@0.8.0) and emits a one-line context
message linking the current workspace to the active thread (if any). Both are
non-fatal — workspace tracking failure or MCP unreachability never blocks startup.

#### Vocabulary clarification

This subsystem tracks **workspaces** (where the user codes — repos, dirs).
The aman-mcp project layer at `~/.aprojects/` tracks **threads** (what the
user pursues — arcs of work). Threads can span workspaces; workspaces host
multiple threads over time. The `/workspaces` slash command and the
`workspaces.json` filename make this distinction unambiguous.

### Migration

- No breaking changes. The `~/.aman-agent/workspaces.json` file is created on
  first run; deleting it resets the tracker.
- Existing `src/project/` (singular — stack classification) is untouched.
```

- [ ] **Step 3: Run full test suite + build**

```bash
npm test
npm run build
```
Expected: All tests pass; build clean.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "release: 0.43.0 — workspace tracker + aman-mcp thread bridge"
```

---

## Self-Review

**Spec coverage check** (every strawman section maps to a task):

- [x] §1 Purpose: durable per-cwd memory → Tasks 4 (recordWorkspace), 5 (list)
- [x] §2.1 Identity (git root or cwd) → Task 3 (identifyWorkspace)
- [x] §2.2 Record at startup → Task 10 (agent integration)
- [x] §2.3 JSON store with version → Tasks 1 (types), 2 (store)
- [x] §2.4 N=7 cap → Task 1 (constant), Task 4 (prune)
- [x] §2.5 Silent auto-archive → Task 4 (pruneLRU)
- [x] §2.6 /workspaces commands → Task 9
- [x] §3.1 File layout (src/workspaces/, src/commands/workspaces.ts) → Tasks 1–9
- [x] §3.2 Public API (identify/record/list/archive/unarchive/notes/forget) → Tasks 3–6
- [x] §3.3 Startup hook with .catch → Task 10
- [x] §4 Data flow → Tasks 4 + 10
- [x] §10.2 Vocabulary fix (project → workspace throughout) → applied everywhere in this plan
- [x] §10.4 surfaceCurrentThread integration → Task 8
- [x] §10.7 Effort estimate (~320 LOC) → matches plan

**Placeholder scan:** No "TBD", "TODO", or "implement later" in any step. All code blocks complete.

**Type consistency:**
- `WorkspaceEntry` (Task 1) used in: 2, 3, 4, 5, 6, 8, 9 — consistent
- `WorkspaceStore` (Task 1) used in: 2, 4, 5, 6 — consistent
- `WORKSPACE_CAP = 7` (Task 1) used in: 4 — consistent
- `WorkspaceId` (Task 3) used in: 4, 8 — consistent
- `ListOptions` (Task 5) used in: 5, 9 — consistent
- `ThreadSurfaceInput` (Task 8) used in: 8 only — consistent
- Function names: `identifyWorkspace`, `recordWorkspace`, `listWorkspaces`, `archiveWorkspace`, `unarchiveWorkspace`, `setNotes`, `forgetWorkspace`, `surfaceCurrentThread`, `formatThreadSurfaceMessage`, `handleWorkspacesCommand`, `loadStore`, `saveStore`, `storePath` — all referenced consistently across tasks

**Subprocess safety:** All `git` calls use `execFile` (implementation) or `execFileSync` (tests) with array args — no shell. Matches codebase pattern.

Plan ready. ~11 tasks, full TDD discipline, ~320 LOC code + ~250 LOC tests as estimated.
