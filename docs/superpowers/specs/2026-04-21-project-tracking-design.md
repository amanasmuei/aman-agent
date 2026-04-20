# Project Tracking + LRU Cap — Design Spec (Strawman)

**Status:** strawman, pending human review
**Roadmap item:** #8 ("LRU-7 project cap — hard slot limit on project detection/tracking")
**Date:** 2026-04-21
**Author:** aman-agent session

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
