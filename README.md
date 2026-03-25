<div align="center">

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/aman--agent-runtime_layer-white?style=for-the-badge&labelColor=0d1117&color=58a6ff">
  <img alt="aman-agent" src="https://img.shields.io/badge/aman--agent-runtime_layer-black?style=for-the-badge&labelColor=f6f8fa&color=24292f">
</picture>

### Your AI companion, running locally.

Loads the full aman ecosystem and runs a streaming AI agent in your terminal — identity, memory, tools, workflows, guardrails, and skills in every conversation.

<br>

[![npm](https://img.shields.io/npm/v/@aman_asmuei/aman-agent?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@aman_asmuei/aman-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/amanasmuei/aman-agent/ci.yml?style=flat-square&label=tests)](https://github.com/amanasmuei/aman-agent/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
[![aman](https://img.shields.io/badge/part_of-aman_ecosystem-ff6b35.svg?style=flat-square)](https://github.com/amanasmuei/aman)

[Quick Start](#quick-start) · [What It Loads](#what-it-loads) · [Commands](#commands) · [Configuration](#configuration) · [Ecosystem](#the-ecosystem)

</div>

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

```bash
# Install globally (optional)
npm install -g @aman_asmuei/aman-agent

# Or run directly
npx @aman_asmuei/aman-agent

# Override model per session
npx @aman_asmuei/aman-agent --model claude-opus-4-6
```

---

## What It Loads

On every session start, aman-agent assembles your full AI context:

| Layer | Source | What it provides |
|:------|:-------|:-----------------|
| **Identity** | `~/.acore/core.md` | AI personality, your preferences, relationship state |
| **Memory** | `~/.amem/memory.db` | Past decisions, corrections, patterns |
| **Tools** | `~/.akit/kit.md` | Available capabilities (GitHub, search, databases) |
| **Workflows** | `~/.aflow/flow.md` | Multi-step processes (code review, bug fix) |
| **Guardrails** | `~/.arules/rules.md` | Safety boundaries and permissions |
| **Skills** | `~/.askill/skills.md` | Deep domain expertise |

All layers are optional — the agent works with whatever you've set up.

---

## Commands

Inside the running agent:

| Command | What it does |
|:--------|:-------------|
| `/help` | Show available commands |
| `/identity` | View your AI identity |
| `/tools` | View installed tools |
| `/workflows` | View defined workflows |
| `/rules` | View guardrails |
| `/skills` | View installed skills |
| `/model` | Show current LLM model |
| `/reconfig` | Reset LLM configuration |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

---

## Supported LLMs

| Provider | Models | Status |
|:---------|:-------|:-------|
| **Anthropic** | Claude Sonnet, Opus, Haiku | Recommended — full tool use |
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5 | Full tool use |
| **Ollama** | Llama, Mistral, Gemma | Coming soon |
| **Google** | Gemini Pro, Flash | Coming soon |

---

## Configuration

Config is stored in `~/.aman-agent/config.json`. Treat this file like a credential — it contains your API key.

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250514"
}
```

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

| Layer | Package | What it does |
|:------|:--------|:-------------|
| Identity | [acore](https://github.com/amanasmuei/acore) | Personality, values, relationship memory |
| Memory | [amem](https://github.com/amanasmuei/amem) | Automated knowledge storage (MCP) |
| Tools | [akit](https://github.com/amanasmuei/akit) | 15 portable AI tools (MCP + manual fallback) |
| Workflows | [aflow](https://github.com/amanasmuei/aflow) | Reusable AI workflows |
| Guardrails | [arules](https://github.com/amanasmuei/arules) | Safety boundaries and permissions |
| Skills | [askill](https://github.com/amanasmuei/askill) | Domain expertise |
| Evaluation | [aeval](https://github.com/amanasmuei/aeval) | Relationship tracking |
| Channels | [achannel](https://github.com/amanasmuei/achannel) | Telegram, Discord, webhooks |
| **Unified** | **[aman](https://github.com/amanasmuei/aman)** | **One command to set up everything** |

---

## Contributing

Contributions welcome! Open an issue or submit a PR.

## License

[MIT](LICENSE)

---

<div align="center">

**One command. Full context. Your AI.**

</div>
