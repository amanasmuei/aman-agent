# Contributing to aman-agent

Thanks for helping build the aman ecosystem. This guide codifies the
conventions and release discipline — most of it is only in people's
heads today, so writing it down saves us all time.

## Local development

```bash
git clone https://github.com/amanasmuei/aman-agent.git
cd aman-agent
npm install
npm test                 # 939 tests; should pass on a clean checkout
npm run build            # produces dist/ (≤550 KB JS; enforced in CI)
npm run lint             # tsc --noEmit, must be clean before PR
```

Everything the agent writes lives in `~/.aman-agent/`. Use
`/reset all` inside the agent (or delete the dir) to start fresh
between experiments.

## Code layout

- `src/agent.ts` — message loop
- `src/commands.ts` — **slash-command dispatcher only**. 133-line
  switch statement; do **not** add handler logic here.
- `src/commands/<name>.ts` — one file per slash command. Add new
  commands here. Keep each module self-contained.
- `src/commands/shared.ts` — types + helpers shared across handlers
- `src/orchestrator/`, `src/github/`, `src/dev/` — larger subsystems

Before adding a new slash command: pick a module under `src/commands/`
or create one, then wire it into `KNOWN_COMMANDS` and the dispatcher
switch in `commands.ts`. See `commands/reminder.ts` for a minimal
example, `commands/memory.ts` for a feature-rich one.

## Commits

Conventional-commit prefixes are load-bearing here — they feed the
changelog and release notes. Use:

- `feat:` new user-facing capability
- `fix:` bug fix that landed in a shipped version
- `refactor:` code movement without behavior change
- `chore:` tooling, deps, CI, release plumbing
- `docs:` README, CHANGELOG, inline docs
- `test:` test-only changes

One concern per commit. If a commit touches `refactor` + `feat`,
split it — reviewers can accept one without the other.

## Publishing (tag-push only)

**Never `npm publish` locally.** The release pipeline is in
`.github/workflows/release.yml` and runs on tag push. Local publishes
bypass the CI gate, skip provenance signing, and have historically
raced with another machine's publish.

### Stable release (`latest` tag)

```bash
# 1. Bump version in package.json (e.g. 0.42.0 → 0.43.0)
# 2. Update CHANGELOG.md with the release notes
# 3. Commit + push to main
git commit -am "chore: bump to v0.43.0"
git push

# 4. Tag and push the tag — this triggers release.yml
git tag v0.43.0
git push origin v0.43.0
```

### Pre-release (`next` tag)

**Always pass `--tag next` when publishing pre-releases**, or npm
silently clobbers the `latest` dist-tag and every new user gets the
pre-release. The release workflow handles this for tags matching
`v*-alpha*`, `v*-beta*`, `v*-rc*`:

```bash
git tag v0.43.0-beta.1
git push origin v0.43.0-beta.1
```

If a pre-release slips onto `latest` by accident, fix with metadata
only (**not** a republish):

```bash
npm dist-tag add @aman_asmuei/aman-agent@0.42.0 latest
npm dist-tag add @aman_asmuei/aman-agent@0.43.0-beta.1 next
```

## CI gates

Every PR must pass:

- `tsc --noEmit` (zero errors)
- `vitest run` (zero failures; currently 939 tests)
- Bundle size: `dist/*.js` ≤ **550 KB**
  (set in `.github/workflows/ci.yml`; raise with justification, not
  reflex)

Provider drift is caught by the nightly real-terminal smoke tests —
fake-LLM unit tests can miss SDK flag renames (e.g. the copilot CLI's
`--print` → `--prompt` rename that only a real spawn caught).

## PRs

- Include a **Summary** (what changed, in 1–3 bullets) and a **Test
  plan** (checklist of what you verified).
- Keep PRs ≤ 500 lines of diff where possible. Split otherwise.
- Don't merge your own PR unless explicitly requested. CODEOWNERS
  review is the gate.

## The ecosystem

aman-agent is one layer among several. Before proposing a new
feature, check whether it belongs here or in a sibling package:

- `@aman_asmuei/amem-core` — memory storage, embeddings, reranking
- `@aman_asmuei/acore-core` — identity, dynamics
- `@aman_asmuei/arules-core` — guardrails
- `aman-mcp`, `aman-claude-code`, `aman-copilot` — integrations

If you're adding something that would belong in those, open the issue
in that repo instead.

## Questions

Open an issue on GitHub or ping the relevant CODEOWNER. Memory-system
questions → amem. Orchestration → aman-agent. Identity/persona →
acore-core.
