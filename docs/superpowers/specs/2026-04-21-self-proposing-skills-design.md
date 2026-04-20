# Self-Proposing Skills — Design Spec (Strawman)

**Status:** strawman, pending human review
**Roadmap item:** #12 (follow-on to #11 passive hook observer)
**Date:** 2026-04-21
**Author:** aman-agent session

---

## 1. Purpose

Extend the passive-observation pattern we shipped for rules (#11, `v3.2.0-alpha.1`
of aman-claude-code) from *corrections* to *workflows*. Where the rules observer
watches for repeated corrections ("no, don't do X") and proposes a rule, the
skills observer watches for repeated *action sequences* (user always runs
`npm test` after `git commit`; assistant always does `git pull` before
`git merge`) and proposes a **skill candidate** the user can accept into
`~/.askill/skills.md`. The goal is to make skill crystallization ambient instead
of requiring an explicit postmortem trigger — any recurring micro-workflow
becomes a candidate for automation surface-area.

---

## 2. Key decisions (strawman — each flagged as ASSUMPTION)

Every decision below is reviewable next session. These are defensible defaults,
not final answers.

### 2.1 Where does detection live?

**Decision:** plugin hook in aman-claude-code (parallel to the #11 observer),
writing tallies to a shared on-disk queue that aman-agent reads.

**ASSUMPTION: reviewable next session.** The rules observer already lives in the
plugin's hook layer because only the plugin sees the raw Claude Code message
stream in real time. Skill detection needs the same stream (tool-call events
+ user messages), so co-locating is the minimum viable move. aman-agent's
`src/observation.ts` is a *session-scoped* observation layer (per-run
`ObservationEvent`s flushed to `.jsonl`) — it sees tool calls during an aman-agent
session, but not during plain Claude Code use. A plugin-hook detector covers
both contexts for free.

**Rejected for v1:** an MCP tool (too heavy — requires explicit invocation);
aman-agent-only internal detector (misses plain Claude Code sessions, which is
where most workflows happen).

### 2.2 What pattern types?

**Decision:** tool-call sequences only for v1 ("after tool A, tool B follows
within N steps"). User-assistant micro-workflow detection deferred.

**ASSUMPTION: reviewable next session.** Tool-call sequences are structurally
detectable without NLP — just a sliding window over the hook event stream. The
cheapest high-signal pattern is **bigrams** (A-then-B) and **trigrams**
(A-then-B-then-C) of tool names, optionally scoped by arg shape (e.g. `Bash(git
commit *)` → `Bash(npm test)`). This is the minimum viable detector.

User-assistant workflows ("user always says 'deploy' then assistant runs
these three commands") need semantic clustering of user intent, which is
v2 territory.

### 2.3 Threshold

**Decision:** 3 repetitions within a rolling 14-day window, matching the rules
observer's 3-count threshold.

**ASSUMPTION: reviewable next session.** Same threshold keeps the UX consistent
— users already understand "show me something after I've done it 3 times." The
rolling window prevents stale patterns from the distant past from promoting.
Window length (14d) is a guess; could be 7d or 30d.

### 2.4 Where do suggestions land?

**Decision:** `~/.askill/suggestions.md`, parallel to
`~/.arules/dev/plugin/suggestions.md`.

**ASSUMPTION: reviewable next session.** Keeps the rules/skills filesystem story
symmetric. Same format as the rules suggestions file (markdown, one candidate
per section with metadata block) so the review command can reuse parsing logic.

Open question: do we want a scope axis (dev/plugin vs global) like rules
have? For v1, skills are global (`~/.askill/skills.md` has no scope), so
suggestions are global too.

### 2.5 Review UX

**Decision:** extend the existing `/skills` command with a `review` action:
- `/skills review --list` — show pending candidates
- `/skills accept <n>` — promote candidate N to `~/.askill/skills.md` via the
  existing `crystallization.ts` writer
- `/skills reject <n>` — drop candidate N, add to rejection log

**ASSUMPTION: reviewable next session.** Mirrors `/rules review` exactly. The
parallel UX is the whole point — once a user learns one, they know the other.

### 2.6 Explicitly deferred (out of scope for v1)

- LLM-assisted pattern classification (e.g. "this sequence looks like a
  'ship-a-PR' workflow")
- Semantic deduplication between observed patterns and existing skills
  (for v1, trust the user to `reject` dupes)
- Cross-session deduplication beyond exact-string match on the (A, B, C)
  tool-name tuple
- User-assistant micro-workflows (see 2.2)
- Per-project scope (like dev rules) — v1 is global only

---

## 3. Architecture

### 3.1 File layout

**In aman-claude-code (plugin):**
```
hooks/
  skill-observer.ts          NEW — sliding-window detector, parallel to observer.ts
  skill-observer.test.ts     NEW
data/
  skill-tallies.json         NEW — on-disk tally store (plugin-local, written by hook)
```

**In aman-agent:**
```
src/
  skill-suggestions.ts       NEW — reads ~/.askill/suggestions.md, parses candidates
  commands/
    skills.ts                EXTEND — add `review`, `accept`, `reject` subcommands
  crystallization.ts         REUSE — accept <n> calls existing writer path
```

**User filesystem:**
```
~/.askill/
  skills.md                  EXISTING — accepted skills land here
  suggestions.md             NEW — pending candidates, parallel to ~/.arules/.../suggestions.md
  rejections.log             NEW — rejected candidates (prevents re-suggestion)
```

### 3.2 Data flow

```
Claude Code hook stream
        │
        ▼
skill-observer.ts  (sliding window, n=3..5)
        │
        ├─ extract tool-call bigrams/trigrams
        ├─ normalize (e.g. Bash(git commit -m "*") → Bash(git commit))
        │
        ▼
skill-tallies.json  (increment count per pattern key)
        │
        │ when count >= 3 within window
        ▼
~/.askill/suggestions.md  (promote — append candidate block)
        │
        ▼
user runs /skills review --list
        │
        ▼
user runs /skills accept <n>
        │
        ▼
crystallization.ts writer → ~/.askill/skills.md
(remove from suggestions.md)
```

Rejection path: `/skills reject <n>` → append to `rejections.log`, remove from
`suggestions.md`, detector consults rejection log to suppress future promotion
of the same pattern key.

---

## 4. Non-goals

- **Not building a full workflow recorder.** We are not capturing command
  transcripts or building replayable macros. A skill is still human-authored
  markdown; the detector just suggests *what to author*.
- **Not doing semantic skill discovery.** No "this looks similar to skill X"
  — that is a v2 feature and needs an embedding store.
- **Not proposing skills without repetition evidence.** One-shot "hey this
  would be cool" is out; the detector only fires on observed recurrence.
- **Not editing existing skills.** If a pattern overlaps with an installed
  skill, we surface that as "collides with X" (reusing the existing collision
  path in `crystallization.ts`) and let the user decide.
- **Not per-project scope.** v1 is global-user only.

---

## 5. Interaction with existing features

- **#11 observer (rules):** independent but structurally identical. Shares no
  code in v1 — we accept the duplication to keep rollout simple. If the pattern
  survives review, we extract a shared `suggestion-queue.ts` module in v2.
- **`src/crystallization.ts`:** reused as-is for the accept path. Its existing
  collision detection (skill name + trigger overlap) handles the "user
  accepted a pattern that duplicates an existing skill" case.
- **`src/skill-engine.ts`:** unchanged. Auto-triggering of existing skills
  continues to work; new accepted skills flow into the same
  `~/.askill/skills.md` file it already reads.
- **Postmortem path / `/skills crystallize`:** unchanged. Postmortem-driven
  crystallization remains the high-effort, high-quality path. The
  self-proposing path is the low-effort, high-recall complement. Both write to
  the same `~/.askill/skills.md` via the same writer.
- **`src/observation.ts`:** not used for detection (session-scoped only), but
  *could* be a secondary signal in v2 (e.g. "during aman-agent sessions the
  user also shows pattern X").

---

## 6. Rollout plan

**Phase 1 — alpha, gated.** Ship behind `AMAN_SKILL_OBSERVER=1` env var,
default off. Same gating pattern as the rules observer's alpha.

**Phase 2 — alpha default-on.** After 2 weeks of dogfood with no bad
promotions (false positives), flip default to on for alpha plugin builds.

**Phase 3 — GA.** Promote to stable plugin release alongside rules-observer
GA, so both ship together under one "ambient learning" story.

Telemetry (opt-in, local-only): count (detections, promotions, accepts,
rejects) per week in a local log. No network calls.

---

## 7. Open questions for next session

1. **Pattern normalization granularity.** Do we collapse `Bash(git commit -m
   "fix: foo")` and `Bash(git commit -m "feat: bar")` into the same pattern
   key `Bash(git commit)`? Too aggressive and we lose signal; too specific
   and we never hit threshold. Proposal: strip args after the subcommand for
   `Bash`, keep verbatim for other tools. Needs user call.

2. **Who authors the candidate skill content?** The detector sees "A then B
   happens often." Someone has to turn that into a skill with a name,
   description, and steps. Options: (a) template-fill — fixed format like
   `Skill: <tool-A>-then-<tool-B>`, user edits on accept; (b) LLM-draft on
   promotion — aman-agent calls the model to draft a candidate block; (c)
   only promote a bare pattern record and make the user author via
   `/skills crystallize`. Option (a) is cheapest, (b) is best UX, (c) is
   safest. Needs a product call.

3. **Cross-session tally persistence vs reset.** Does the tally window roll
   across sessions (needs disk state — proposed above) or reset per session?
   Proposed: disk state with 14-day rolling window. But that means a pattern
   from last week counts toward today's promotion. Acceptable? And: do we
   GC the tally file, or let it grow?

4. **(bonus) Should rejection be sticky forever, or time-boxed?** If the
   user rejects a pattern today but repeats it 50 times next month, do we
   re-propose? Proposed default: sticky for 90 days.

5. **(bonus) Multi-agent context.** If the user is running aman-agent as a
   sub-process, do its tool calls count toward the parent Claude Code
   session's tallies? (Probably no — they're a different execution
   context — but the hook will see them in the same stream.)

---

*End of strawman. Next session: review §2 assumptions, resolve §7, then
write the implementation plan.*
