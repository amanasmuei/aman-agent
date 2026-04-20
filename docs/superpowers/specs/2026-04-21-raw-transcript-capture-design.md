# Raw Transcript Capture — Design Spec (Strawman)

**Status:** STRAWMAN — every product decision is flagged `ASSUMPTION`. Push back.
**Date:** 2026-04-21
**Roadmap item:** #4 — raw conversation transcript capture

---

## 1. Purpose

aman-agent relies on `amem` for conversational recall. `amem` produces a
*curated* layer: an LLM extracts decisions, preferences, topology, and facts,
yielding ~10–50 memories per session. Excellent for high-signal recall — but
lossy by construction. When a user later asks "what did we decide about X
last Tuesday?" and X was never elevated to a memory, the record is gone. This
spec proposes a raw, durable, local, privacy-scrubbed log of every message
in every aman-agent CLI session, stored as JSONL and queryable via a
grep-backed `/transcript search` slash command. It is the **raw layer below
amem**, not a replacement — amem stays primary; transcripts are the long-tail
fallback. Prior mitigations (`prompt-best-practices.md`, aman-copilot's
`/session-narrative`, amem's `reflection.ts`) reduced but did not close this gap.

---

## 2. Key decisions (strawman)

### 2.1 Scope — aman-agent CLI only (v1)

**ASSUMPTION.** Capture only aman-agent's own CLI sessions. aman-claude-code
rides Claude Code's auto-memory; aman-copilot has VS Code's chat history.
Unifying three pipelines before we've proven the format is premature. Defer
cross-surface sync to v2.

### 2.2 Storage format — JSONL

**ASSUMPTION.** One JSON object per line. Fields: `ts` (ISO-8601 UTC),
`sessionId` (ULID, stable per agent run), `role` (`user`|`assistant`|`tool`),
`content` (redacted; §6), `projectPath?`, `model?`, `toolName?`,
`schemaVersion: 1`.

JSONL over SQLite because `grep`/`rg` work out of the box (and grep *is* the
v1 recall primitive, §2.7), the files are human-readable under duress,
append-only is crash-tolerant, and users can `git add` the dir if they want.
Cost accepted: O(n) scan on search — offset by month-sharding and recency
bias.

### 2.3 Storage location

**ASSUMPTION.** `~/.aman-agent/transcripts/<YYYY-MM>/<sessionId>.jsonl`.
Month-sharding keeps any one directory tractable for heavy users. One file
per session (not per day) gives crash isolation, clean deletion granularity,
and matches how users think ("that session last Tuesday"). Honors
`AMAN_AGENT_HOME` (hermetic-test pattern, already established).

### 2.4 Retention — 90 days default, configurable

**ASSUMPTION.** `transcriptRetentionDays: 90` in `config.json`. Set to `0`
to keep forever. A sweeper runs on agent startup (§3.4), deletes files
whose mtime exceeds the threshold. Time-based over size-based: simpler to
explain, 90 days of text is well under 100 MB for most users. See §9.1.

### 2.5 Privacy — strip before write

**ASSUMPTION.** Redaction happens **in the writer, before the line hits
disk**. Two passes: (1) `<private>...</private>` regions (same convention
as the observer) → `[REDACTED:private]`; tags stripped; multi-line and
nested supported. (2) Secret-shaped strings via the observer's regex
battery: `sk-...` API keys, `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` GitHub
tokens, `AKIA...` AWS keys, `xox[baprs]-...` Slack, ≥40-char hex, PEM
private-key blocks. Match → `[REDACTED:<kind>]` with coarse kind labels
(`api_key`, `github_token`, `aws_key`, `hex`, `pem`) — never the secret's
prefix. Redaction is one-way. Full model in §6.

### 2.6 Recall interface — `/transcript search <query>`

**ASSUMPTION.** New slash command: `/transcript search "q" [--since 7d]
[--role user] [--session <id>] [--context N]`. Plus `/transcript list
[--since 30d]` and `/transcript purge <sessionId>`. Output: top N matching
lines, newest first, grouped by session, each prefixed `[<ts>
<sessionId-short> <role>]`. `--context N` mirrors `grep -C`.

### 2.7 No LLM-based recall in v1

**ASSUMPTION.** Grep + recency/frequency ranking only. Rationale: **cost**
(amem already does the expensive semantic path; transcripts should be the
cheap path); **role clarity** (if transcripts also did semantic search,
users would not know which tool to reach for — grep is deliberately a
different tool); **shippable** (grep-over-JSONL is ~50 LOC; semantic layer
is weeks). v2 may add it, but only if amem's coverage is demonstrably
insufficient for a query class we can name. See §9.4.

### 2.8 Integration with amem

**ASSUMPTION.** Transcripts are the **raw layer below amem's curated
memories**. amem's extraction runs as before, unchanged. Transcripts are
written in parallel, independent — if amem fails or is disabled,
transcripts still capture. `/transcript search` is documented as the
**fallback when amem missed it**, not the primary recall path. Future
(out of scope): `reflection.ts` could mine transcripts for synthesis
candidates. Explicitly v2+.

---

## 3. Architecture

Four small, independent modules.

**3.1 `src/transcript/writer.ts`** — fire-and-forget JSONL appender.
`createTranscriptWriter({ home, sessionId, projectPath?, enabled })` returns
an object with non-blocking `append(entry)`, plus `flush()` and `close()`
for shutdown/tests. One file handle per session, opened lazily on first
append. Redaction (§2.5) runs in-process before the write. Writes go
through an async queue; caller never awaits. On crash: at most the last
unflushed entries are lost (§9.5). Disabled config → no-op writer.

**3.2 `src/transcript/reader.ts`** — grep + rank backing `/transcript
search`. `searchTranscripts({ home, query, since?, role?, sessionId?,
limit?, contextLines? })`. Ranking (v1, intentionally naive):
case-insensitive substring match; score = `recencyWeight(ts) +
frequencyInSession`, where `recencyWeight = exp(-ageDays / 14)` (two-week
half-life). Ties broken by ts desc. Month-sharding means we scan only
shards overlapping `--since`. Ranking sits behind an interface so it's
swappable (§9.7).

**3.3 `src/commands/transcript.ts`** — slash-command dispatcher. Parses
subcommands (`search`, `purge`, `list`), validates args, calls
reader/writer, formats output. Follows existing `src/commands/` patterns.

**3.4 Retention sweeper** — ~20 LOC: walk
`~/.aman-agent/transcripts/`, stat each file, delete when mtime exceeds
`transcriptRetentionDays`. Skip if retention is `0`. Piggybacks on agent
startup — not a daemon. Users who never start aman-agent won't see
pruning. Good enough.

---

## 4. Data flow

**Write path (per-message):** user input received → `writer.append({role:
"user", ...})` async → LLM call proceeds normally → on completion,
`writer.append({role: "assistant", ...})` then one `append({role: "tool",
...})` per tool call. **The message loop never awaits the writer.** A slow
disk cannot block the conversation. Non-negotiable (§9.5).

**Startup:** `loadConfig()` → if `captureTranscripts`, create writer →
`retentionSweeper.run()` fire-and-forget.

**Search path:** `/transcript search "q"` → `commands/transcript.ts` →
`reader.searchTranscripts(...)` → enumerate shards overlapping `--since`,
stream lines, `JSON.parse`, filter by query/role/session, rank, return
top N → format → render.

**Shutdown:** SIGINT / normal exit → `writer.close()` awaited with ~500 ms
timeout. Timeout → drop buffered entries. Conversation integrity >
transcript completeness.

---

## 5. Interaction with existing features

- **amem curated memory** — primary recall. Transcripts are the fallback.
  No data flow between them in v1.
- **`memoryLog` (existing)** — complementary, not redundant. `memoryLog`
  records system/meta actions ("memory X was written"); transcripts record
  conversational content. Different axes. They overlap only where
  `memoryLog` entries are rendered inline in assistant output — those
  lines land in both, which is fine.
- **Post-mortem system** — reads post-hoc off curated state; transcripts
  are the live record. Post-mortems *could* consult transcripts (v2).
- **Observer's redaction** — reused wholesale. Same helpers, one source
  of truth for "what counts as a secret."
- **`<private>...</private>` convention** — same as observer; users who
  already use the tag get transcript privacy for free.
- **aman-copilot `/session-narrative`** — different surface (VS Code),
  different output (prose). Complementary.
- **`config.json`** — adds `captureTranscripts: boolean` and
  `transcriptRetentionDays: number`.

---

## 6. Privacy model

Privacy is the biggest concern in this spec. No hand-waving.

**Threat model — protects against:** (1) accidental self-exposure on
shared screens (redaction); (2) another user on the same macOS account
reading files (`0700`/`0600`); (3) backup leakage to Time Machine / iCloud
(already redacted); (4) `git add ~/` accidents (already redacted). **Does
not protect against:** determined local attacker with root; model-side
retention (orthogonal); screenshots / terminal scrollback.

**Redaction detail.** `<private>...</private>` — multi-line and nested —
replaced with `[REDACTED:private]`, tags stripped. Applied to user *and*
assistant content. Secret-shaped strings (§2.5) → `[REDACTED:<kind>]` with
coarse kind. **Tool results are redacted too** — tool output frequently
contains credentials (env dumps, `cat ~/.aws/credentials`). Redaction runs
**before** JSON serialization; the escaped form on disk contains only the
redacted text.

**Filesystem hygiene.** `~/.aman-agent/transcripts/` created `mode: 0700`;
month shards inherit `0700`; `.jsonl` files written `mode: 0600` via
`fs.open` flags. Sweeper re-asserts these modes on startup (cheap defense
against a sloppy `chmod` elsewhere).

**User controls.** Disable entirely: `captureTranscripts: false`. Purge a
session: `/transcript purge <sessionId>`. Purge everything (documented):
`rm -rf ~/.aman-agent/transcripts/`. Manual edit: user owns the files; we
don't fight them.

**What we do *not* do.** No telemetry. Transcripts never leave the user's
machine. No automatic cloud sync (user opts in via git if they want). No
cross-session linking beyond `sessionId` — no user-id, no device-id.

---

## 7. Non-goals (v1)

1. **No cross-device sync.** Users who want it can `git init` the dir.
2. **No semantic embedding search.** amem does that for curated;
   transcripts get grep. Flip condition in §9.4.
3. **No plugin-side capture.** aman-claude-code and aman-copilot already
   have native logging. Unifying is v2+.
4. **No markdown / HTML export.** Raw JSONL is readable enough
   (`jq -r '.content'` works). Follow-up if asked for.
5. **No compression.** Would break grep-ability, the whole point of §2.2.
6. **No edit history.** Append-only in practice; no undo on manual edits.

---

## 8. Rollout plan

**ASSUMPTION.** Ship on `main`, gated behind `captureTranscripts: true`.
Defaults: new installs `true`; existing users on upgrade also default
`true`, **but** a one-time notice prints on first post-upgrade run
(feature, location, retention default, how to disable).
`transcriptNoticeShown: true` recorded in config after display. This is the
biggest assumption in the spec — a privacy-conscious user may reasonably
prefer **opt-in only** (default `false`). See §9.6. Flipping the default
is a one-line change. Config loader defaults `captureTranscripts: true`
and `transcriptRetentionDays: 90` if absent. Transcripts dir created
lazily on first write — zero disk usage until the user runs the agent.

**Tests (hermetic, `AMAN_AGENT_HOME` pattern):** writer (three messages,
assert JSONL + private/secret redaction); reader (fixture week, assert
ranking); retention (mtime-manipulate fixtures, run sweeper, assert
deletions); privacy (secrets of every shape in input → none leak to
disk); shutdown (SIGINT mid-stream → no corruption, file parses).

---

## 9. Open questions

**9.1 Retention: N days or N MB?** Time is simpler. Size protects
small-disk users. Hybrid ("90 days OR 500 MB, whichever comes first")
doubles config surface. Lean: time-only for v1, revisit if a heavy user
complains.

**9.2 Encryption at rest?** `0700` perms do not stop `sudo`. A
passphrase-derived key per-file would help, but breaks `grep`, adds a
passphrase-entry UX problem, and a user can move the dir to an encrypted
volume today. **Punt to v2** unless a concrete request arrives.

**9.3 Redundancy with amem's `memory_log`?** `memory_log` records
meta-actions; transcripts record conversational content. Overlap only
where `memory_log` entries are rendered inline in assistant output. No
dedup needed in v1.

**9.4 Should `/transcript search` resurrect a session?** "Continue where
we left off Tuesday" would require a `/transcript resume` command,
replay into the context window (truncation/summarization — context limits
bite), and resolution of model drift across versions. Worth a separate
spec. v1 ships search only.

**9.5 Write semantics: sync vs async?** Async (default) never blocks but
a hard crash loses last unflushed entries. Sync is zero-loss but every
message waits for disk. Middle path: async + `fsync` on every Nth message
(or on `flush()`). Probably the middle path — call it out, don't hide it.

**9.6 Default on or default off?** §8 assumes default-on to maximize
recall value (feature only helps if it captured the message *before* you
asked). Privacy-conscious users may reasonably want default-off to
maximize agency. **This is the single decision most worth pushing back on
before we code.**

**9.7 Ranking — is grep + recency enough?** v1 says yes. If users report
"I know I said X but search can't find it", the next upgrade is
tokenization + stemming, not embeddings. Keep the ranking function behind
an interface so it's swappable.

---

## 10. Summary of assumptions

All open to revision: (1) scope limited to aman-agent CLI; (2) JSONL over
SQLite; (3) month-sharded layout; (4) 90-day time-based retention;
(5) redact-before-write, reuse observer regexes; (6) grep-only search, no
LLM; (7) transcripts as raw layer below amem; (8) default-on for new
users, notice on upgrade; (9) async, fire-and-forget write path. None
locked. Push back on any before we implement.
