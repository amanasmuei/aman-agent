<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/aman--agent-runtime_layer-white?style=for-the-badge&labelColor=0d1117&color=58a6ff">
    <img alt="aman-agent" src="https://img.shields.io/badge/aman--agent-runtime_layer-black?style=for-the-badge&labelColor=f6f8fa&color=24292f">
  </picture>
</p>

<h1 align="center">aman-agent</h1>

<p align="center">
  <strong>Your AI companion, running locally.</strong>
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
  Loads the full aman ecosystem and runs a streaming AI agent in your terminal —<br/>
  identity, memory, tools, workflows, guardrails, and skills in every conversation.
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#-what-it-loads">What It Loads</a> &bull;
  <a href="#-whats-new-in-v040">What's New</a> &bull;
  <a href="#-commands">Commands</a> &bull;
  <a href="#-supported-llms">LLMs</a> &bull;
  <a href="#-the-ecosystem">Ecosystem</a>
</p>

---

## The Problem

AI coding assistants forget everything between sessions. You re-explain your stack, preferences, and boundaries every time. There's no single place where your AI loads its full context and just *works*.

## The Solution

**aman-agent** loads your entire AI ecosystem into a local streaming agent. One command. Full context. Every session.

```bash
npx @aman_asmuei/aman-agent
```

First run walks you through LLM configuration. After that, just run and talk.

> **Your AI knows who it is, what it remembers, what tools it has, and what rules to follow — before you say a word.**

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

## What's New in v0.4.0

| Feature | Before | After |
|---|---|---|
| **Streaming with tools** | Blocked — no output until LLM finishes | Real-time streaming, even during tool calls |
| **Conversation persistence** | 200-char resume, full history lost | Full conversation saved to amem on exit |
| **Context management** | Messages grow forever, eventual crash | Auto-trims at 80K tokens, keeps recent context |
| **`/save` command** | N/A | Manually save conversation mid-session |
| **Reminders/Schedules** | Broken — lost on exit, no daemon | Removed (replaced with `/save`) |

---

## What It Loads

On every session start, aman-agent assembles your full AI context:

| Layer | Source | What it provides |
|:---|:---|:---|
| **Identity** | `~/.acore/core.md` | AI personality, your preferences, relationship state |
| **Memory** | `~/.amem/memory.db` | Past decisions, corrections, patterns, conversation history |
| **Tools** | `~/.akit/kit.md` | Available capabilities (GitHub, search, databases) |
| **Workflows** | `~/.aflow/flow.md` | Multi-step processes (code review, bug fix) |
| **Guardrails** | `~/.arules/rules.md` | Safety boundaries and permissions |
| **Skills** | `~/.askill/skills.md` | Deep domain expertise |

All layers are optional — the agent works with whatever you've set up.

### Token Budgeting

Layers are included by priority when space is limited:

```
Identity (always) → Guardrails → Workflows → Tools → Skills (can truncate)
```

Default budget: 8,000 tokens. Override with `--budget`.

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
| `/status` | Ecosystem dashboard |
| `/doctor` | Health check all layers |
| `/save` | Save conversation to memory |
| `/model` | Show current LLM model |
| `/update` | Check for updates |
| `/reconfig` | Reset LLM configuration |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

---

## Supported LLMs

| Provider | Models | Tool Use | Streaming |
|:---|:---|:---|:---|
| **Anthropic** | Claude Sonnet 4.5, Opus 4.6, Haiku 4.5 | Full | Full (with tools) |
| **OpenAI** | GPT-4o, GPT-4o Mini, o3 | Full | Full (with tools) |
| **Ollama** | Llama, Mistral, Gemma, any local model | Text only | Full |

---

## How It Works

```
┌──────────────────────────────────────────────┐
│              Your Terminal                   │
│                                              │
│   You > tell me about our auth decisions     │
│                                              │
│   Agent > [using memory_recall...]           │
│   Based on your previous decisions:          │
│   - OAuth2 with PKCE (decided 2 weeks ago)   │
│   - JWT for API tokens...                    │
└─────────────────┬────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────┐
│          aman-agent runtime                  │
│                                              │
│   System Prompt Assembly                     │
│   ┌─────────────────────────────────────┐    │
│   │ Identity + Memory + Tools +         │    │
│   │ Workflows + Guardrails + Skills     │    │
│   │ (priority-based token budgeting)    │    │
│   └─────────────────────────────────────┘    │
│                                              │
│   Streaming LLM Client                       │
│   ┌─────────────────────────────────────┐    │
│   │ Anthropic / OpenAI / Ollama         │    │
│   │ Always streaming, even with tools   │    │
│   └─────────────────────────────────────┘    │
│                                              │
│   Context Manager                            │
│   ┌─────────────────────────────────────┐    │
│   │ Auto-trim at 80K tokens             │    │
│   │ Keep initial context + recent msgs  │    │
│   └─────────────────────────────────────┘    │
│                                              │
│   MCP Integration                            │
│   ┌─────────────────────────────────────┐    │
│   │ aman-mcp  →  identity, tools, eval  │    │
│   │ amem      →  memory, knowledge      │    │
│   └─────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### Session Lifecycle

1. **Start** — Load ecosystem, connect MCP servers, recall memory context
2. **Chat** — Stream responses, execute tools with guardrail checks, match workflows
3. **Auto-trim** — Compress old messages when approaching token limits
4. **Exit** — Save conversation to amem, update session resume, rate session

---

## Configuration

Config is stored in `~/.aman-agent/config.json`:

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250514"
}
```

| Option | CLI Flag | Default |
|:---|:---|:---|
| Model override | `--model <id>` | From config |
| Token budget | `--budget <n>` | 8000 |

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
| Memory | [amem](https://github.com/amanasmuei/amem) | Persistent memory with knowledge graph (MCP) |
| Tools | [akit](https://github.com/amanasmuei/akit) | Portable AI tools (MCP + manual fallback) |
| Workflows | [aflow](https://github.com/amanasmuei/aflow) | Reusable AI workflows |
| Guardrails | [arules](https://github.com/amanasmuei/arules) | Safety boundaries and permissions |
| Skills | [askill](https://github.com/amanasmuei/askill) | Domain expertise |
| Evaluation | [aeval](https://github.com/amanasmuei/aeval) | Relationship tracking |
| Channels | [achannel](https://github.com/amanasmuei/achannel) | Telegram, Discord, webhooks |
| **Unified** | **[aman](https://github.com/amanasmuei/aman)** | **One command to set up everything** |

</details>

---

## Contributing

```bash
git clone https://github.com/amanasmuei/aman-agent.git
cd aman-agent && npm install
npm run build   # zero errors
npm test        # 61 tests pass
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
