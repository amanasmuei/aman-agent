# Changelog

All notable changes to aman-agent are documented here.

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
The surfaced message currently routes to `log.debug` (rotating file at
`~/.aman-agent/debug.log`) — not yet user-visible at terminal startup. Promote
to a console line in a follow-up if the surfacing should be louder.

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

## [0.40.0] - 2026-04-13

### Added
- **Unified orchestration runner** (`runOrchestrationFull`) — single entry point wiring scheduler + circuit breaker + cost tracker + checkpoint + policy + self-review
- **Smart orchestrate** (`smartOrchestrate`) — top-level pipeline with auto project detection, template selection, and profile auto-install
- **Profile auto-install** — orchestrator profiles automatically installed to `~/.acore/profiles/` on first use

## [0.39.0] - 2026-04-13

### Added
- **Phase 1: Orchestrator Engine**
  - DAG-based task decomposition with Zod-validated schemas
  - Parallel execution scheduler with configurable concurrency
  - Multi-tier model router (fast/standard/advanced LLM tiers)
  - Human approval gates that pause orchestration
  - Immutable state machine with exhaustive transition validation
  - LLM-driven requirement decomposition
  - Structured audit trails
  - `/orchestrate` command

- **Phase 2: GitHub-Native Automation**
  - Safe `gh` CLI wrapper via `execFile` (no shell injection)
  - Issue-to-DAG planner: fetch issue → decompose into TaskDAG
  - PR manager: create branches, open PRs, post comments
  - CI gate: poll workflow status, wait for CI
  - `/github` command with `issues`, `prs`, `plan`, `ci` subcommands

- **Phase 3: Agent Factory Profiles**
  - 4 specialized profiles: architect, security, tester, reviewer
  - 3 workflow templates: fullFeature, bugFix, securityAudit
  - Self-review loop for automated quality gates

- **Phase 4: Universal Project Manager**
  - Project type classifier (web-frontend, api-backend, mobile, etc.)
  - Module boundary mapper for parallel agent isolation
  - Orchestration monitoring with phase timing and agent metrics

- **Phase 5: Enterprise Hardening**
  - Circuit breaker with closed/open/half-open states
  - Checkpoint/resume for crash recovery
  - Cost tracker with per-tier token counting and budget enforcement
  - Policy engine with 7 built-in governance rules

## [0.34.0] - 2026-04-12

### Added
- Multi-editor dev mode (`--copilot`, `--cursor`)
- `aman-agent dev` generates project-specific context for Claude Code, Copilot, or Cursor

## [0.33.0] - 2026-04-11

### Added
- `aman-agent dev` — project stack detection, memory recall, CLAUDE.md generation
- Smart mode (`--smart`) for LLM-synthesized context
- Staleness detection and auto-update

## [0.32.0] - 2026-04-10

### Added
- One-liner install script (no Node.js required)
- Docker support
- Consolidated config under `~/.aman-agent/`
- `aman-agent setup`, `update`, `uninstall` commands
