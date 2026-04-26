# Project Tracking + LRU Cap — Design Spec (Strawman)

**Status:** strawman, pending human review — **reconciled 2026-04-26 against aman-mcp@0.8.0 (see Section 10)**
**Roadmap item:** #8 ("LRU-7 project cap — hard slot limit on project detection/tracking")
**Date:** 2026-04-21 (reconciliation appended 2026-04-26)
**Author:** aman-agent session

> **Reading guide.** Sections 1–9 are the original April 21 strawman, preserved as history. **Section 10** is the post-2026-04-26 reconciliation: aman-mcp@0.8.0 shipped a *thread*-shaped project-tracking layer that overlaps in name but not in semantics with this *workspace*-shaped tracker. Read Section 10 first if you're picking up this spec fresh — it reframes the scope of what's left to build here.

> **Scope note.** The roadmap entry described a *cap*, but no list exists to
> cap. `src/project/detector.ts` only *classifies* cwd (frontend/backend/...)
> to pick an orchestration template — it persists no history. This spec
> therefore covers the **entire new subsystem** (tracker + store + startup
> hook + slash commands) with the Miller-7 cap baked in from day one.

---

## 1. Purpose

Give aman-agent a durable, small memory of *which projects the user works
in*, so future sessions can say "last time you were in `aman-copilot`, we
decided X," and so future features (cross-repo memory recall, project-scoped
rules, per-project session resumption) have a stable handle to key off of.
Today the agent is fully amnesic about repo identity — every run is a blank
slate except for classification of the current directory. A tracked list of
recent projects turns that slate into a short, human-scale index. The cap
(N=7, Miller's law) keeps the index human-scale: any bigger list silently
becomes "all projects, ever," which is what shell history is for.

---

## 2. Key decisions (strawman — each flagged as ASSUMPTION)

Every decision below is reviewable next session. These are defensible defaults,
not final answers.

### 2.1 What constitutes a "project"?

**Decision:** the git repo root, via `git rev-parse --show-toplevel`, if the
cwd is inside a git repo. If not, the absolute path of cwd at the time
aman-agent was invoked.

**ASSUMPTION: git-first; non-git dirs tracked by absolute path.** Matches
how users think about projects (one repo = one project) and avoids logging
a new project on every subdirectory `cd`. Non-git fallback covers scratch
dirs, `/tmp/...` experiments, and unversioned notes. Worktrees: see Q8.2.

### 2.2 When is a project "recorded"?

**Decision:** at aman-agent startup, inside `runAgent`, before the REPL
loop. If the resolved path matches the last-recorded entry, just touch
`lastSeen`. Otherwise create/update and run the LRU prune.

**ASSUMPTION.** Record-on-startup is simplest and piggybacks on I/O the
agent already does. Alternatives (first-command, on-memory-access) add
coupling.

### 2.3 Store format

**Decision:** JSON array at `~/.aman-agent/projects.json`, entries shaped as:

```jsonc
{
  "path": "/Users/.../aman-copilot",  // absolute, canonical (realpath)
  "name": "aman-copilot",             // basename(path) for display
  "firstSeen": "2026-04-21T10:00:00.000Z",
  "lastSeen":  "2026-04-21T14:32:11.000Z",
  "archived":  false,
  "notes":     "optional free-form string"
}
```

Top-level file shape: `{ "version": 1, "projects": [ ... ] }` so we have a
migration seam if shape ever changes.

**ASSUMPTION.** A flat JSON array is fine at N=7 active + however-many
archived; no need for SQLite. We already write JSON to `~/.aman-agent/` for
`bg-tasks.json` and `config.json`, so this fits the directory's existing
convention.

### 2.4 LRU cap value

**Decision:** N = 7 active projects (Miller's law — magical number
seven, plus or minus two). Archived projects don't count toward the cap.

**ASSUMPTION.** 7 is the value the user flagged in the original audit. 5 and
9 are both defensible; revisit once we have real usage telemetry.

### 2.5 What happens when the cap is exceeded?

**Decision:** when insert/update would push active count > 7, set
`archived: true` on the active entry with the oldest `lastSeen`. Archived
entries remain in the file (no deletion on auto-archive).

**ASSUMPTION.** Silent auto-archive, no prompt — the subsystem should be
invisible when working. User can `/projects unarchive` if wrong. Archived
entries stay so "did I ever work in repo X?" still resolves.

### 2.6 Commands

**Decision:** new `/projects` slash-command family:

- `/projects` — list active, newest `lastSeen` first, with age.
- `/projects all` — include archived (dim, `[archived]` marker).
- `/projects archive <name>` — manually archive (frees a slot).
- `/projects unarchive <name>` — re-activate; if cap would overflow,
  auto-archive oldest active first.
- `/projects notes <name> <text>` — set/replace `notes`; empty clears.
- `/projects forget <name>` — hard-remove entry, with confirmation.

**ASSUMPTION.** `<name>` is case-insensitive basename match; ambiguity
returns a disambiguation list with full paths.

---

## 3. Architecture

### 3.1 File layout

```
src/projects/                      # NEW — plural, distinct from
                                   # src/project/ (classification)
  tracker.ts                       # CRUD + LRU prune + identifyProject()
  store.ts                         # atomic JSON read/write + Zod
  index.ts                         # re-exports
src/commands/projects.ts           # slash-command handlers
~/.aman-agent/projects.json        # store file
```

`src/project/` (singular) stays as-is. The plural-vs-singular naming is
deliberately jarring; a module header in `src/projects/` calls it out.

### 3.2 Public API (tracker.ts)

```ts
export async function identifyProject(cwd: string): Promise<ProjectId>;
//  -> { path, name } — git root if available, else cwd

export async function recordProject(cwd: string): Promise<ProjectEntry>;
//  -> called by runAgent at startup; handles LRU prune internally

export async function listProjects(opts?: { includeArchived?: boolean }):
  Promise<ProjectEntry[]>;

export async function archiveProject(name: string): Promise<void>;
export async function unarchiveProject(name: string): Promise<void>;
export async function setNotes(name: string, text: string): Promise<void>;
export async function forgetProject(name: string): Promise<void>;
```

### 3.3 Startup hook

In `src/agent.ts`, near the top of `runAgent`, after config load, add:

```ts
await recordProject(process.cwd()).catch((err) =>
  logger.warn("project tracking failed (non-fatal)", err),
);
```

**Non-fatal by design.** A corrupt `projects.json` must never block startup;
on any error: log + continue. A `memory_doctor`-style repair is v2.

### 3.4 Integration with memory / identity / rules

**Out of scope for v1.** The store knows `path` and `name`; nothing else
keys off them yet. Cross-linking (project-scoped memory/rules/identity) is
v2. v1 just *tracks*; the index is scaffolding for later features.

---

## 4. Data flow

```
runAgent()
  └─ recordProject(cwd)
       ├─ identifyProject(cwd)         → { path, name }
       ├─ store.load()                 → { version, projects[] }
       ├─ find existing by path
       │    ├─ hit  → touch lastSeen, archived = false (reviving counts as use)
       │    └─ miss → push new entry  (firstSeen = lastSeen = now)
       ├─ pruneLRU(projects, cap=7)    → mark oldest active as archived
       └─ store.save(atomic rename)
```

Atomic save: write to `projects.json.tmp`, `fs.rename()` over the real file.
Same pattern amem uses for its stores.

---

## 5. Interaction with existing features

- **`src/project/detector.ts`** — untouched. Classification (*kind* of
  project) is orthogonal to tracking (which projects I've been in). Neither
  reads the other's state.
- **Memory tiering (core/working/archival)** — unrelated. Project
  `archived: true` is a cap-overflow marker, *not* memory archival. Calling
  that out explicitly since the word collision will bite someone.
- **Postmortems** — remain session-scoped. v2 can add `projectPath` for
  cross-session recall if desired.
- **Background tasks (`bg-tasks.json`)** — independent store, same directory,
  no cross-references in v1.
- **acore scope inheritance** — orthogonal. Scopes address a different
  problem than per-repo identity.

---

## 6. Non-goals (v1)

- No memory filtering by project (v2).
- No project-scoped identity or rules (acore scope inheritance handles that —
  different abstraction).
- No auto-detect from git worktrees; repo root is the only identifier.
  A worktree under `~/proj/aman-agent-wt/` is recorded as the main repo.
  (See Q8.2.)
- No cross-machine sync. The file lives in `~/.aman-agent/`; rsyncing it
  will not reliably resolve paths. Noted, not solved.
- No telemetry, prompts, or UI beyond slash commands.
- No project "types" beyond `active` / `archived`.

---

## 7. Rollout plan

Ship directly on `main` — no env gate, no feature flag. The only
always-on addition is `recordProject(cwd)` wrapped in `.catch()`; worst case
is a log warning. All behavior is additive (users who never type `/projects`
just get a new JSON file in `~/.aman-agent/`). Rollback is a one-line revert.
Release: minor bump (`aman-agent@X.Y+1.0`), changelog entry for the new file
and commands. No migration needed — the tracker creates the store on first run.

---

## 8. Open questions

1. **Should memory recall scope-filter by project?** (v2 decision.) Options:
   *silent filter* (recall only current project's memories by default) vs.
   *additive boost* (all memories, current project boosted). Additive is
   safer — boosts can be ignored, filters can't be un-filtered.
2. **Worktrees — one project per worktree, or one per main repo?** Today's
   proposal treats all worktrees as the same project (`git rev-parse
   --show-toplevel` returns the main repo root from inside a worktree).
   Right for "which repos?", wrong for "what did I decide on this feature
   branch?". Needs user input on which use case dominates.
3. **Archive leaks cross-machine if the user syncs `~/.aman-agent/`?**
   Archived entries carry absolute paths + free-form `notes`. Options:
   (a) refuse to resolve entries whose path doesn't exist locally,
   (b) scrub on sync, (c) add `origin-host` and warn on mismatch,
   (d) document file as single-machine. Privacy-default → (a) + (d).
4. **Need a repair/doctor command?** Defer — add if corruption shows up
   in the wild. `projects.json` is tiny, writes are atomic.
5. **Should `/projects` mark the current project?** Probably yes
   (`>` prefix). Trivial UX, flagging for consistency.

---

## 9. Estimated effort

~270 LOC (tracker + store + commands) + ~200 LOC hermetic tests via
`AMAN_AGENT_HOME`. Single session, no coordination required.

---

## 10. Reconciliation with aman-mcp@0.8.0 (2026-04-26)

> **Why this section exists.** Five days after this strawman was written, `@aman_asmuei/aman-mcp@0.8.0` shipped a project-tracking subsystem to the aman ecosystem. The names collide ("project tracking + LRU cap" appears on both sides), but the *concepts* don't — they're complementary, not duplicate. This section reconciles the divergence and updates the scope of what's left to build here.

### 10.1 The divergence

| | This strawman (Apr 21) | aman-mcp@0.8.0 (Apr 26, shipped) |
|---|---|---|
| **What's a "project"?** | git repo root (auto-detected from cwd at startup) | named topical work-thread (manually created via `project_add`) |
| **Cardinality** | One per repo | One per arc-of-work; can span repos |
| **Detection** | `git rev-parse --show-toplevel` on `runAgent()` startup | Conversational: "I got a new project, building X" |
| **LRU cap** | N=7 (Miller's law) | N=10 (sample-derived, hardcoded v1, parameterizable later) |
| **Storage** | `~/.aman-agent/projects.json` (flat JSON, owned by aman-agent) | `~/.aprojects/dev/plugin/projects.md` (MarkdownFileStorage, scope-aware, owned by aman-mcp) |
| **Lifecycle field?** | `archived: boolean` (cap-overflow marker only) | `status: active \| paused \| complete \| abandoned` + orthogonal `inActiveList: boolean` |
| **Niyyah-aware?** | No (just path + name + dates) | Yes (optional `niyyah` field, optional `linkedIntentionId`) |
| **Conceptually** | **Workspace** — *where I code* | **Thread** — *what I pursue* |
| **Status** | Strawman, not yet implemented | Shipped to npm, Claude Code plugin live |

The two layers reference each other implicitly: `aman-mcp.Project.workspaces: string[]` already references workspace paths. Tonight's ship baked in the integration seam without naming it.

### 10.2 Vocabulary fix — "project" is overloaded; this strawman is about **workspaces**

To eliminate the name collision:

- **Rename throughout this spec** (when implemented): `project` → `workspace` for this subsystem.
- File: `~/.aman-agent/projects.json` → **`~/.aman-agent/workspaces.json`**
- Slash commands: `/projects` → `/workspaces` (or `/ws`)
- Function names: `recordProject(cwd)` → `recordWorkspace(cwd)`, `identifyProject(cwd)` → `identifyWorkspace(cwd)`, etc.

Why: in the unified ecosystem, **"project" now consistently means a thread of work** (one's `linkedIntentionId`, one's session log, one's niyyah). Repos are **workspaces** that *host* threads. Mixing the two terms costs us clarity for years.

### 10.3 Recommended integration shape — keep separate, link via aman-mcp

The two layers are complementary at different cardinalities. Don't merge them into one. Instead:

1. **aman-agent owns workspace tracking** — local to its runtime, JSON store as designed in §3, N=7 cap, slash commands, the works. Its job: *which repo am I in right now?*
2. **aman-mcp owns thread tracking** — already shipped at `~/.aprojects/dev/plugin/projects.md`. Its job: *which arc of work am I pursuing?*
3. **Integration via `aman-mcp.Project.workspaces[]`** — when a thread spans multiple repos, those repo paths populate this array. The aman-agent workspace tracker can be the *source of truth* for the current cwd anchor; aman-mcp threads reference workspace paths but don't manage them.

### 10.4 New behavior at `runAgent()` startup (revised data flow)

Replacing the §4 data flow:

```
runAgent()
  ├─ recordWorkspace(cwd)                ← this strawman, unchanged
  │    ├─ identifyWorkspace(cwd)         → { path, name }
  │    ├─ load ~/.aman-agent/workspaces.json
  │    ├─ touch lastSeen / push new entry
  │    ├─ pruneLRU(active=7)
  │    └─ atomic save
  │
  └─ surfaceCurrentThread(cwd)           ← NEW, integrates aman-mcp
       ├─ call mcp__aman__project_active() via MCP client
       ├─ if active thread exists:
       │    ├─ log: "Workspace: <name>; current thread: <thread.name>"
       │    └─ if cwd ∈ thread.workspaces: anchor inline ("you're in <ws>, part of <thread>")
       ├─ if no active thread but workspaces.json shows recurring repo:
       │    └─ suggest: "Want to start a thread for <ws>?" (passive, one-time)
       └─ never auto-create threads
```

This uses aman-mcp's tools at runtime but doesn't depend on aman-mcp at install time (graceful degradation if MCP server unreachable).

### 10.5 Should workspace tracking move to aman-mcp?

**Decision:** No, not in v1. Reasoning:

- Workspace tracking is **runtime-local** — it's about "which cwd is this aman-agent process in *right now*." Moving it to aman-mcp would push runtime concerns into substrate.
- aman-mcp is already neutral and broadly useful (any MCP-speaking agent can use thread tracking). Adding workspace concerns there couples it to the assumption that the runtime has a meaningful cwd, which isn't true for all consumers (e.g., a web-hosted Arienz with no cwd).
- The existing `aman-mcp.Project.workspaces[]` array is sufficient as the integration point. aman-agent populates it from its own workspace tracker; other runtimes can populate it differently or leave it empty.

**Revisit if:** multiple runtimes (web client, daemon, IDE plugin) all need workspace tracking and start to duplicate aman-agent's logic. At that point, extract a shared workspace tracker into aman-core.

### 10.6 Open questions added by tonight's ship

(In addition to the original §8 list — those still stand.)

**8.6 — Should workspace tracking auto-suggest thread creation?**
When a workspace is first detected, aman-mcp has zero threads referencing it. Options: (a) silent (just track the workspace), (b) ask once ("start a thread for `<ws>`?"), (c) auto-create a thread named after the workspace.
**Lean: (b).** Auto-creation pollutes the LRU; silence misses the obvious bootstrap moment.

**8.7 — Memory / amem scope: workspace OR thread OR both?**
Original §8.1 asked "should memory recall scope-filter by project?" — that question now bifurcates. Workspace-scoped recall ("what did I do last time I was in `aman-copilot`?") and thread-scoped recall ("what did I decide on Phase 1.5 substrate?") are different axes. Probably both, with thread taking precedence when present.

**8.8 — Worktrees revisited.**
Original §8.2 noted worktrees collapse to main repo path under the workspace model. Threads handle this naturally — different feature branches *in the same workspace* can be different threads. So the worktree problem is now less about workspace identity and more about *which thread is active in this branch*. Possibly: future `aman-agent` integration could detect git branch and prompt "different thread for this branch?"

**8.9 — Cross-machine sync changes shape.**
Original §8.3 worried about archive paths leaking. With threads in `~/.aprojects/` (no absolute paths in core fields), only the workspaces array contains cross-machine-fragile data. So cross-machine sync of threads is *more* portable than workspaces. Reflects the substrate-sovereignty principle: the *what I pursue* is portable; the *where I code* is machine-local.

### 10.7 Estimated effort — revised

Original §9 estimated ~270 LOC (tracker + store + commands) + ~200 LOC tests.

**Revised:** still ~270 LOC + tests for the workspace tracker (rename-only changes from the original). **Plus** ~50 LOC for `surfaceCurrentThread(cwd)` integration with aman-mcp (an MCP-client call wrapped in graceful-degradation).

Total: ~320 LOC + tests. Single session, but with one external dependency (the aman-mcp client must be available at runtime — already in scope since aman-agent already ships an MCP client for amem).

### 10.8 What's actively unchanged from the original strawman

These §3 decisions still stand under the workspace reframing:

- §3.1 store version field for migration seam ✅
- §3.2 atomic save via tmp file + rename ✅
- §3.3 corrupt-store-fail-open (never block startup) ✅
- §3.4 v1 doesn't cross-link with memory/identity/rules (deferred — see §8.7) ✅
- §6 non-goals (no telemetry, no cross-machine sync, no scope filter) ✅
- §7 rollout plan (ship on main, no feature flag, additive only) ✅

### 10.9 Status after this reconciliation

- Strawman remains pending human review.
- Reframed as a **workspace tracker** (not a project tracker — that name now belongs to aman-mcp's thread layer).
- Integration shape with aman-mcp@0.8.0 documented (§10.3 / §10.4); requires `surfaceCurrentThread()` addition at runtime.
- Effort revised slightly upward (~50 LOC) for the integration call; nothing else changes.
- **Next decision:** human review of this reconciliation; if accepted, the original §3–§9 implementation can proceed under the new vocabulary.

---

*Reconciliation appended 2026-04-26 by Arienz, post aman-mcp@0.8.0 ship.*
