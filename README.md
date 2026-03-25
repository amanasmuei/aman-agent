<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/aman--agent-runtime_layer-white?style=for-the-badge&labelColor=0d1117&color=58a6ff">
    <img alt="aman-agent" src="https://img.shields.io/badge/aman--agent-runtime_layer-black?style=for-the-badge&labelColor=f6f8fa&color=24292f">
  </picture>
</p>

<h1 align="center">aman-agent</h1>

<p align="center">
  <strong>The AI companion that actually remembers you.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aman_asmuei/aman-agent"><img src="https://img.shields.io/npm/v/@aman_asmuei/aman-agent?style=for-the-badge&logo=npm&logoColor=white&color=cb3837" alt="npm version" /></a>
  &nbsp;
  <a href="https://github.com/amanasmuei/aman-agent/actions"><img src="https://img.shields.io/github/actions/workflow/status/amanasmuei/aman-agent/ci.yml?style=for-the-badge&logo=github&label=CI" alt="CI status" /></a>
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License" /></a>
  &nbsp;
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 18+" />
  &nbsp;
  <a href="https://github.com/amanasmuei/aman"><img src="https://img.shields.io/badge/part_of-aman_ecosystem-ff6b35?style=for-the-badge" alt="aman ecosystem" /></a>
</p>

<p align="center">
  An AI companion that learns from every conversation, recalls relevant memories per message,<br/>
  extracts knowledge silently, and adapts to your time of day — all running locally.
</p>

<p align="center">
  <img src="docs/demo/demo.gif" alt="aman-agent demo" width="720" />
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#-intelligent-companion-features">Features</a> &bull;
  <a href="#-how-it-works">How It Works</a> &bull;
  <a href="#-commands">Commands</a> &bull;
  <a href="#-supported-llms">LLMs</a> &bull;
  <a href="#-the-ecosystem">Ecosystem</a>
</p>

---

## The Problem

AI coding assistants forget everything between sessions. You re-explain your stack, preferences, and boundaries every time. There's no single place where your AI loads its full context and just *works*.

Other "memory" solutions are just markdown files the AI reads on startup — they don't *learn* from conversation, they don't *recall* per-message, and they silently lose context when the window fills up.

## The Solution

**aman-agent** is the first open-source AI companion that genuinely learns from conversation. It doesn't just store memories — it recalls them per-message, extracts new knowledge automatically, and uses your LLM to intelligently compress context instead of truncating it.

```bash
npx @aman_asmuei/aman-agent
```

> **Your AI knows who it is, what it remembers, what tools it has, what rules to follow, what time it is, and what reminders are due — before you say a word.**

---

## Quick Start

### 1. Run

```bash
# Run directly (always latest)
npx @aman_asmuei/aman-agent

# Or install globally
npm install -g @aman_asmuei/aman-agent
```

### 2. Configure

First run prompts for your LLM provider, API key, and model. Config saved to `~/.aman-agent/config.json`.

### 3. Talk

```bash
# Override model per session
aman-agent --model claude-opus-4-6

# Adjust system prompt token budget
aman-agent --budget 12000
```

---

## Intelligent Companion Features

### Per-Message Memory Recall with Progressive Disclosure

Every message you send triggers a semantic search against your memory database. Results use **progressive disclosure** — a compact index (~50-100 tokens) is injected instead of full content (~500-1000 tokens), giving **~10x token savings**. The agent shows the cost:

```
You > Let's set up the auth service

  [memories: ~47 tokens]

  Agent recalls:
  a1b2c3d4 [decision] Auth service uses JWT tokens... (92%)
  e5f6g7h8 [preference] User prefers PostgreSQL... (88%)
  i9j0k1l2 [fact] Auth middleware rewrite driven by compliance... (75%)

Aman > Based on our previous decisions, I'll set up JWT-based auth
       with PostgreSQL, keeping the compliance requirements in mind...
```

### Hybrid Memory Extraction

After every response, the agent analyzes the conversation and extracts memories worth keeping. Preferences, facts, patterns, and topology are stored silently. Decisions and corrections require your confirmation.

```
You > I think we should go with microservices for the payment system

Aman > That makes sense given the compliance isolation requirements...

  Remember: "Payment system will use microservices architecture"? (y/N) y
  [1 memory stored]
```

### LLM-Powered Context Summarization

When the conversation gets long, the agent uses your LLM to generate real summaries — preserving decisions, preferences, and action items. No more losing critical context to 150-character truncation.

### Parallel Tool Execution

When the AI needs multiple tools, they run in parallel via `Promise.all` instead of sequentially. Faster responses, same guardrail checks.

### Retry with Backoff

LLM calls and MCP tool calls automatically retry on transient errors (rate limits, timeouts) with exponential backoff and jitter. Auth errors fail immediately.

### Passive Tool Observation Capture

Every tool the AI executes is automatically logged to amem's conversation log — tool name, input, and result. This happens passively (fire-and-forget) without slowing down the agent. Your AI builds a complete history of what it *did*, not just what it *said*.

### Token Cost Visibility

Every memory recall shows how many tokens it costs, so you always know the overhead:

```
  [memories: ~47 tokens]
```

### Time-Aware Greetings

The agent knows the time of day and day of week. It adapts its tone naturally — you'll notice the difference between a morning and a late-night session.

### Reminders

```
You > Remind me to review PR #42 by Thursday

Aman > I'll set that reminder for you.
  [Reminder set: "Review PR #42" — due 2026-03-27]
```

Next session:
```
  [OVERDUE] Review PR #42 (was due 2026-03-27)
```

Reminders persist in SQLite across sessions. Set them, forget them, get nudged.

### Memory Consolidation

On every startup, the agent automatically merges duplicate memories, prunes stale low-confidence ones, and promotes frequently-accessed entries.

```
  Memory health: 94% (merged 2 duplicates, pruned 1 stale)
```

### Structured Debug Logging

Every operation that can fail logs to `~/.aman-agent/debug.log` with structured JSON. No more silent failures — use `/debug` to see what's happening under the hood.

---

## How It Works

```
┌───────────────────────────────────────────────────────────┐
│                    Your Terminal                          │
│                                                          │
│   You > tell me about our auth decisions                 │
│                                                          │
│   [recalling memories...]                                │
│   Agent > Based on your previous decisions:              │
│   - OAuth2 with PKCE (decided 2 weeks ago)               │
│   - JWT for API tokens...                                │
│                                                          │
│   [1 memory stored]                                      │
└──────────────────────┬────────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────────┐
│              aman-agent runtime                          │
│                                                          │
│   On Startup                                             │
│   ┌────────────────────────────────────────────────┐     │
│   │ 1. Load ecosystem (identity, tools, rules...)  │     │
│   │ 2. Connect MCP servers (aman-mcp + amem)       │     │
│   │ 3. Consolidate memory (merge/prune/promote)    │     │
│   │ 4. Check reminders (overdue/today/upcoming)    │     │
│   │ 5. Inject time context (morning/evening/...)   │     │
│   │ 6. Recall session context from memory          │     │
│   └────────────────────────────────────────────────┘     │
│                                                          │
│   Per Message                                            │
│   ┌────────────────────────────────────────────────┐     │
│   │ 1. Semantic memory recall (top 5 relevant)     │     │
│   │ 2. Augment system prompt with memories         │     │
│   │ 3. Stream LLM response (with retry)            │     │
│   │ 4. Execute tools in parallel (with guardrails) │     │
│   │ 5. Extract memories from response              │     │
│   │    - Auto-store: preferences, facts, patterns  │     │
│   │    - Confirm: decisions, corrections           │     │
│   └────────────────────────────────────────────────┘     │
│                                                          │
│   Context Management                                     │
│   ┌────────────────────────────────────────────────┐     │
│   │ Auto-trim at 80K tokens                        │     │
│   │ LLM-powered summarization (not truncation)     │     │
│   │ Fallback to text preview if LLM call fails     │     │
│   └────────────────────────────────────────────────┘     │
│                                                          │
│   MCP Integration                                        │
│   ┌────────────────────────────────────────────────┐     │
│   │ aman-mcp  →  identity, tools, workflows, eval  │     │
│   │ amem      →  memory, knowledge graph, reminders │     │
│   └────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────┘
```

### Session Lifecycle

| Phase | What happens |
|:---|:---|
| **Start** | Load ecosystem, connect MCP, consolidate memory, check reminders, inject time context |
| **Each turn** | Recall relevant memories, stream response, execute tools in parallel, extract new memories |
| **Auto-trim** | LLM-powered summarization when approaching 80K tokens |
| **Exit** | Save conversation to amem, update session resume, optional session rating |

---

## Commands

| Command | Description |
|:---|:---|
| `/help` | Show available commands |
| `/identity` | View identity `[update <section>]` |
| `/rules` | View guardrails `[add\|remove\|toggle ...]` |
| `/workflows` | View workflows `[add\|remove ...]` |
| `/tools` | View tools `[add\|remove ...]` |
| `/skills` | View skills `[install\|uninstall ...]` |
| `/eval` | View evaluation `[milestone ...]` |
| `/memory` | View memories `[search\|clear ...]` |
| `/decisions` | View decision log `[<project>]` |
| `/export` | Export conversation to markdown |
| `/debug` | Show debug log (last 20 entries) |
| `/status` | Ecosystem dashboard |
| `/doctor` | Health check all layers |
| `/save` | Save conversation to memory |
| `/model` | Show current LLM model |
| `/update` | Check for updates |
| `/reconfig` | Reset LLM configuration |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

---

## What It Loads

On every session start, aman-agent assembles your full AI context:

| Layer | Source | What it provides |
|:---|:---|:---|
| **Identity** | `~/.acore/core.md` | AI personality, your preferences, relationship state |
| **Memory** | `~/.amem/memory.db` | Past decisions, corrections, patterns, conversation history |
| **Reminders** | `~/.amem/memory.db` | Overdue, today, and upcoming reminders |
| **Tools** | `~/.akit/kit.md` | Available capabilities (GitHub, search, databases) |
| **Workflows** | `~/.aflow/flow.md` | Multi-step processes (code review, bug fix) |
| **Guardrails** | `~/.arules/rules.md` | Safety boundaries and permissions |
| **Skills** | `~/.askill/skills.md` | Deep domain expertise |
| **Time** | System clock | Time of day, day of week for tone adaptation |

All layers are optional — the agent works with whatever you've set up.

### Token Budgeting

Layers are included by priority when space is limited:

```
Identity (always) → Guardrails → Workflows → Tools → Skills (can truncate)
```

Default budget: 8,000 tokens. Override with `--budget`.

---

## Supported LLMs

| Provider | Models | Tool Use | Streaming |
|:---|:---|:---|:---|
| **Anthropic** | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | Full | Full (with tools) |
| **OpenAI** | GPT-4o, GPT-4o Mini, o3 | Full | Full (with tools) |
| **Ollama** | Llama, Mistral, Gemma, any local model | Text only | Full |

---

## Configuration

Config is stored in `~/.aman-agent/config.json`:

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-6",
  "hooks": {
    "memoryRecall": true,
    "sessionResume": true,
    "rulesCheck": true,
    "workflowSuggest": true,
    "evalPrompt": true,
    "autoSessionSave": true,
    "extractMemories": true
  }
}
```

| Option | CLI Flag | Default |
|:---|:---|:---|
| Model override | `--model <id>` | From config |
| Token budget | `--budget <n>` | 8000 |

### Hook Toggles

All hooks are on by default. Disable any in `config.json`:

| Hook | What it controls |
|:---|:---|
| `memoryRecall` | Load memory context on session start |
| `sessionResume` | Resume from last session state |
| `rulesCheck` | Pre-tool guardrail enforcement |
| `workflowSuggest` | Auto-detect matching workflows |
| `evalPrompt` | Session rating on exit |
| `autoSessionSave` | Save conversation to amem on exit |
| `extractMemories` | Auto-extract memories from conversation |

> Treat the config file like a credential — it contains your API key.

---

## The Ecosystem

```
aman
├── acore       → identity    → who your AI IS
├── amem        → memory      → what your AI KNOWS
├── akit        → tools       → what your AI CAN DO
├── aflow       → workflows   → HOW your AI works
├── arules      → guardrails  → what your AI WON'T do
├── askill      → skills      → what your AI MASTERS
├── aeval       → evaluation  → how GOOD your AI is
├── achannel    → channels    → WHERE your AI lives
└── aman-agent  → runtime     → the engine  ← YOU ARE HERE
```

<details>
<summary><strong>Full ecosystem packages</strong></summary>

| Layer | Package | What it does |
|:---|:---|:---|
| Identity | [acore](https://github.com/amanasmuei/acore) | Personality, values, relationship memory |
| Memory | [amem](https://github.com/amanasmuei/amem) | Persistent memory with knowledge graph + reminders (MCP) |
| Tools | [akit](https://github.com/amanasmuei/akit) | Portable AI tools (MCP + manual fallback) |
| Workflows | [aflow](https://github.com/amanasmuei/aflow) | Reusable AI workflows |
| Guardrails | [arules](https://github.com/amanasmuei/arules) | Safety boundaries and permissions |
| Skills | [askill](https://github.com/amanasmuei/askill) | Domain expertise |
| Evaluation | [aeval](https://github.com/amanasmuei/aeval) | Relationship tracking |
| Channels | [achannel](https://github.com/amanasmuei/achannel) | Telegram, Discord, webhooks |
| **Unified** | **[aman](https://github.com/amanasmuei/aman)** | **One command to set up everything** |

</details>

---

## What Makes This Different

### aman-agent vs other companion runtimes

| Feature | aman-agent | Letta / MemGPT | Raw LLM CLI |
|:---|:---|:---|:---|
| Identity system | 7 portable layers | None | None |
| Memory | amem (SQLite + embeddings + graph) | Postgres + embeddings | None |
| Per-message recall | Progressive disclosure (~10x token savings) | Yes | No |
| Learns from conversation | Auto-extract (hybrid confirm) | Requires configuration | No |
| Guardrail enforcement | Runtime tool blocking | None | None |
| Reminders | Persistent, deadline-aware | None | None |
| Context compression | LLM-powered summarization | Archival system | Truncation |
| Tool observation capture | Passive logging of all tool calls | None | None |
| Token cost visibility | Shows memory injection cost per turn | None | None |
| Multi-LLM | Anthropic, OpenAI, Ollama | OpenAI-focused | Single provider |
| Tool execution | Parallel with guardrails | Sequential | None |

### amem vs other memory layers

| Feature | amem | claude-mem (40K stars) | mem0 |
|:---|:---|:---|:---|
| Works with | Any MCP client | Claude Code only | OpenAI-focused |
| Storage | SQLite + local embeddings | SQLite + Chroma vectors | Cloud vector DB |
| Progressive disclosure | Compact index + on-demand detail | Yes (10x savings) | No |
| Memory types | 6 typed (correction > decision > fact) | Untyped observations | Untyped blobs |
| Knowledge graph | Typed relations between memories | None | None |
| Reminders | Persistent, deadline-aware | None | None |
| Scoring | relevance x recency x confidence x importance | Recency-based | Similarity only |
| Consolidation | Auto merge/prune/promote | None | None |
| Version history | Immutable snapshots | Immutable observations | None |
| Token cost visibility | Shown per recall | Shown per injection | None |
| License | MIT | AGPL-3.0 | Apache-2.0 |

> **claude-mem** excels at capturing what Claude Code *did*. **amem** is a structured memory system that works with *any* MCP client, with typed memories, a knowledge graph, reminders, progressive disclosure, and consolidation.

---

## Contributing

```bash
git clone https://github.com/amanasmuei/aman-agent.git
cd aman-agent && npm install
npm run build   # zero errors
npm test        # 84 tests pass
```

PRs welcome. See [Issues](https://github.com/amanasmuei/aman-agent/issues).

---

<p align="center">
  Built by <a href="https://github.com/amanasmuei"><strong>Aman Asmuei</strong></a>
</p>

<p align="center">
  <a href="https://github.com/amanasmuei/aman-agent">GitHub</a> &middot;
  <a href="https://www.npmjs.com/package/@aman_asmuei/aman-agent">npm</a> &middot;
  <a href="https://github.com/amanasmuei/aman-agent/issues">Issues</a>
</p>

<p align="center">
  <sub>MIT License</sub>
</p>
