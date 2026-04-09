# Engine v1 — what changed for aman-agent

aman-agent v0.22.0 is the first release that runs on **engine v1**, a shared substrate published as 3 npm packages:

- [`@aman_asmuei/aman-core`](https://www.npmjs.com/package/@aman_asmuei/aman-core) `^0.2.0` — scope, `withScope`, `Storage<T>`
- [`@aman_asmuei/acore-core`](https://www.npmjs.com/package/@aman_asmuei/acore-core) `^0.2.0` — multi-tenant Identity layer
- [`@aman_asmuei/arules-core`](https://www.npmjs.com/package/@aman_asmuei/arules-core) `^0.2.0` — multi-tenant guardrails layer

## What it means for aman-agent

- **`/identity` and `/rules` slash commands** now call `acore-core` and `arules-core` directly. No MCP round-trip needed for read/list operations.
- **Scope is `dev:agent`** by default — override with `$AMAN_AGENT_SCOPE` (e.g. `dev:agent:work`, `agent:productivity`).
- **218 lines of duplicated akit code removed** from `src/commands.ts`. The hardcoded `AKIT_REGISTRY`, `loadAkitInstalled`, `saveAkitInstalled`, etc. are gone.
- **`/akit` is now an informational stub** pointing at the standalone `npx @aman_asmuei/akit` CLI. This is the engine v1 D4 decision: akit is reclassified as DORMANT and the canonical CLI owns the registry. No more parallel implementations.
- **Bundle shrunk** from 543 KB → 241 KB (after dist build).

## Why it matters

aman-agent is one frontend among four. Now when you fix a bug in identity parsing or guardrail enforcement, **every** frontend (aman-agent CLI, Claude Code via aman-claude-code, Telegram via aman-tg, MCP) gets the fix at once.

## Migration impact

**Existing users:** zero. Your `~/.acore/core.md` and `~/.arules/rules.md` are still readable via the legacy fallback. The `dev:agent` scope reads from `~/.acore/dev/agent/core.md` first if present.

**New behavior to know:**
- `/rules add <category> <text>` no longer needs an MCP server — it writes directly via `arules-core`.
- `/identity update <section> <text>` writes directly via `acore-core`.

## Learn more

- Engine architecture: https://github.com/amanasmuei/aman-core
- Identity layer: https://github.com/amanasmuei/acore-core
- Guardrails layer: https://github.com/amanasmuei/arules-core
