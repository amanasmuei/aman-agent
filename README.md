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
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+" />
  &nbsp;
  <a href="https://github.com/amanasmuei/aman"><img src="https://img.shields.io/badge/part_of-aman_ecosystem-ff6b35?style=for-the-badge" alt="aman ecosystem" /></a>
</p>

<p align="center">
  An AI companion that learns from every conversation, recalls relevant memories per message,<br/>
  extracts knowledge silently, and adapts to your time of day — all running locally.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/amanasmuei/aman-agent/main/docs/demo/demo.gif" alt="aman-agent demo" width="720" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#supported-llms">LLMs</a> &bull;
  <a href="#the-ecosystem">Ecosystem</a> &bull;
  <a href="#faq">FAQ</a>
</p>

---

<details>
<summary><strong>Table of Contents</strong></summary>

- [What's New](#whats-new-in-v0240)
- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Quick Start](#quick-start)
- [Usage Guide](#usage-guide)
  - [Your First Conversation](#your-first-conversation)
  - [How Memory Works](#how-memory-works)
  - [Files & Images](#working-with-files--images)
  - [Plans](#working-with-plans)
  - [Skills](#skills-in-action)
  - [Project Workflow](#project-workflow)
  - [Personality & Wellbeing](#personality--wellbeing)
  - [Customization](#customization)
  - [Showcase Templates](#showcase-templates)
  - [Profiles](#your-profile-vs-agent-profiles)
  - [Delegation](#agent-delegation)
  - [Teams](#agent-teams)
  - [Daily Workflow](#daily-workflow-summary)
- [Features](#features)
- [How It Works](#how-it-works)
- [Commands](#commands)
- [What It Loads](#what-it-loads)
- [Supported LLMs](#supported-llms)
- [Configuration](#configuration)
- [The Ecosystem](#the-ecosystem)
- [What Makes This Different](#what-makes-this-different)
- [FAQ](#faq)
- [Contributing](#contributing)

</details>

---

## What's New in v0.24.0

> **Session telemetry, post-mortem analysis, and a smarter feedback loop.**

The agent now passively observes what happens during a session — tool calls, file changes, sentiment shifts, blockers, milestones — and on session end can generate a structured post-mortem with actionable patterns stored back as memories.

| Feature | What it does |
|:---|:---|
| **Observation system** | Passive event capture: tool calls, errors, file changes, sentiment, topic shifts, blockers, milestones — all written to JSONL, never blocking the user |
| **Post-mortem reports** | LLM-generated session analysis with goals, completed work, blockers, decisions, sentiment arc, recurring patterns, and recommendations |
| **Smart auto-trigger** | Reports generate automatically when sessions hit ≥3 tool errors, ≥2 blockers, &gt;60min, abandoned plan steps, or sustained frustration |
| **Pattern memory loop** | Recurring patterns from post-mortems are stored as `pattern` memories — your AI learns from its own session history |
| **`/observe` dashboard** | Live session stats: tool calls, errors, files changed, blockers, milestones, topic shifts |
| **`/postmortem` commands** | Generate now, view last, list all, or `--since 7d` for cross-session trend analysis |
| **Eval reliability fix** | `/eval report` now uses `fs.existsSync` instead of an ANSI-sensitive prefix check |
| **CI dependency stability** | Switched `npm ci` → `npm install` to handle platform-specific native deps |

<details>
<summary><strong>Highlights from earlier releases</strong></summary>

**v0.18 — User onboarding**
- Interactive first-run setup capturing name, role, expertise, communication style
- 13 showcase templates (fitness, freelancer, Muslim, finance, etc.)
- `/profile me` and `/profile edit` for user identity management

**v0.16 — Session resilience**
- Streaming cancellation (Ctrl+C aborts response, not session)
- Session checkpointing every 10 turns — crash-safe
- MCP auto-reconnect on connection failure
- Token-safe tool loop with conversation trimming inside
- Non-blocking memory extraction

**v0.14 — Sub-agent infrastructure**
- Sub-agent guardrails enforce same safety rules as main agent
- Sub-agent memory recall for better delegation context
- 16K system prompt token ceiling

</details>

<a href="https://github.com/amanasmuei/aman-agent/releases">Full release history →</a>

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

**Zero config if you already have an API key in your environment:**

```bash
# aman-agent auto-detects these (in priority order):
export ANTHROPIC_API_KEY="sk-ant-..."   # → uses Claude Sonnet 4.6
export OPENAI_API_KEY="sk-..."          # → uses GPT-4o
# Or if Ollama is running locally      # → uses llama3.2
```

No env var? First run prompts for your LLM provider and model:

```
◇ LLM provider
│ ● Claude (Anthropic)       — recommended, uses Claude Code CLI
│ ○ GitHub Copilot           — uses GitHub Models API
│ ○ GPT (OpenAI)
│ ○ Ollama (local)           — free, runs offline
```

**Claude** — authentication handled by Claude Code CLI (`claude login`). Supports subscription (Pro/Max/Team/Enterprise), API billing, Bedrock, and Vertex AI. No API key needed.

**GitHub Copilot** — authentication handled by GitHub CLI (`gh auth login`). Uses GitHub Models API with access to GPT-4o, Claude Sonnet, Llama, Mistral, and more.

**OpenAI** — enter your API key directly.

**Ollama** — local models, no account needed.

### 2. First Launch — You'll Be Asked About You

On first run, a quick interactive setup captures who you are:

```
◆ What should I call you?
◆ What's your main thing?     (developer, designer, student, manager, generalist)
◆ How deep in the game?       (beginner → expert)
◆ How do you like answers?    (concise, balanced, thorough, socratic)
◆ What are you working on?    (optional)
◆ Want a companion specialty? (13 pre-built personalities from aman-showcase)
```

Takes ~30 seconds. Update anytime with `/profile edit`.

### 3. Talk

```bash
# Override model per session
aman-agent --model claude-opus-4-6

# Adjust system prompt token budget
aman-agent --budget 12000
```

---

## Usage Guide

A step-by-step walkthrough of how to use aman-agent day-to-day. Click any section below to expand.

<details open>
<summary><strong>Your First Conversation</strong></summary>

### Your First Conversation

On first run, you set up your profile, then the agent greets you personally:

```
$ aman-agent

  aman agent — your AI companion
  ✓ Auto-detected Anthropic API key. Using claude-sonnet-4-6.
  ✓ Profile saved for Aman
  ✓ Loaded: identity, user, guardrails (2,847 tokens)
  ✓ Memory consolidated
  ✓ MCP connected
  ✓ Aman is ready for Aman. Model: claude-sonnet-4-6

You > Hey, I'm working on a Node.js API

 Aman ──────────────────────────────────────────────

  Nice to meet you! I'm Aman, your AI companion. I'll remember
  what matters across our conversations — your preferences,
  decisions, and patterns.

  What kind of API are you building? I can help with architecture,
  auth, database design, or whatever you need.

 ────────────────────────────────────── [1 memory stored]
```

That's it. No setup required. The agent remembers your stack from this point forward.

</details>

<details>
<summary><strong>How Memory Works</strong></summary>

### How Memory Works

Memory is automatic. You don't need to do anything — the agent silently extracts important information from every conversation:

- **Preferences** — "I prefer Vitest over Jest" → remembered
- **Decisions** — "Let's use PostgreSQL" → remembered
- **Patterns** — "User always writes tests first" → remembered
- **Facts** — "The auth service is in /services/auth" → remembered

Memory shows up naturally in responses:

```
You > Let's add a new endpoint

 Aman ──────────────────────────────────────────────

  Based on your previous decisions, I'll set it up with:
  - PostgreSQL (your preference)
  - JWT auth (decided last session)
  - Vitest for tests

 ──────────────────────────────── memories: ~47 tokens
```

**Useful memory commands:**

```
/memory search auth      Search your memories
/memory timeline         See memory growth over time
/decisions               View your decision log
```

</details>

<details>
<summary><strong>Working with Files & Images</strong></summary>

### Working with Files & Images

Reference any file path in your message — it gets attached automatically:

```
You > Review this code ~/projects/api/src/auth.ts

  [attached: auth.ts (3.2KB)]

 Aman ──────────────────────────────────────────────
  Looking at your auth middleware...
```

**Images** work the same way — the agent can see them:

```
You > What's wrong with this schema? ~/Desktop/schema.png

  [attached image: schema.png (142.7KB)]

 Aman ──────────────────────────────────────────────
  I see a few issues with your schema...
```

**Supported files:**
- **Code/text:** `.ts`, `.js`, `.py`, `.go`, `.rs`, `.md`, `.json`, `.yaml`, and 30+ more
- **Images:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp` (also URLs)
- **Documents:** `.pdf`, `.docx`, `.xlsx`, `.pptx` (via Docling)

Multiple files in one message work too.

</details>

<details>
<summary><strong>Working with Plans</strong></summary>

### Working with Plans

Plans help you track multi-step work that spans sessions.

**Create a plan:**

```
You > /plan create Auth API | Ship JWT auth | Design schema, Build endpoints, Write tests, Deploy

  Plan created!

  Plan: Auth API (active)
  Goal: Ship JWT auth
  Progress: [░░░░░░░░░░░░░░░░░░░░] 0/4 (0%)

     1. [ ] Design schema
     2. [ ] Build endpoints
     3. [ ] Write tests
     4. [ ] Deploy

  Next: Step 1 — Design schema
```

**Mark progress as you work:**

```
You > /plan done

  Step 1 done!

  Plan: Auth API (active)
  Progress: [█████░░░░░░░░░░░░░░░] 1/4 (25%)

     1. [✓] Design schema
     2. [ ] Build endpoints      ← Next
     3. [ ] Write tests
     4. [ ] Deploy
```

**The AI knows your plan.** Every turn, the active plan is injected into context. The AI knows which step you're on and reminds you to commit after completing steps.

**Resume across sessions.** Close the terminal, come back tomorrow — your plan is still there:

```
$ aman-agent

  Welcome back. You're on step 2 of Auth API — Build endpoints.
```

**All plan commands:**

```
/plan                Show active plan
/plan done [step#]   Mark step complete (next if no number)
/plan undo <step#>   Unmark a step
/plan list           Show all plans
/plan switch <name>  Switch active plan
/plan show <name>    View a specific plan
```

Plans are stored as markdown in `.acore/plans/` — they're git-trackable.

</details>

<details>
<summary><strong>Skills in Action</strong></summary>

### Skills in Action

Skills activate automatically based on what you're talking about. No commands needed.

```
You > How should I handle SQL injection in this query?

  [skill: security Lv.3 activated]
  [skill: database Lv.2 activated]

 Aman ──────────────────────────────────────────────
  Use parameterized queries — never interpolate user input...
```

**Skills level up as you use them:**

| Level | Label | What changes |
|:---|:---|:---|
| Lv.1 | Learning | Detailed explanations, examples |
| Lv.2 | Familiar | Brief reasoning, show patterns |
| Lv.3 | Proficient | Task-focused, skip basics |
| Lv.4 | Advanced | Edge cases, proactive suggestions |
| Lv.5 | Expert | Just execute, no hand-holding |

Skills also self-improve — when the agent learns your patterns (e.g., "user prefers Prisma over raw SQL"), it enriches the skill with your preferences.

**12 built-in skill domains:** testing, api-design, security, performance, code-review, documentation, git-workflow, debugging, refactoring, database, typescript, accessibility

**10 knowledge library items** auto-suggested when relevant: security-headers, docker-node, github-actions, env-config, error-handling, rate-limiter, prisma-setup, zod-validation, testing-patterns, git-hooks

</details>

<details>
<summary><strong>Project Workflow</strong></summary>

### Project Workflow

aman-agent is project-aware. When you run it in a project directory, it loads project-specific context.

**Set up a project:**

```bash
cd ~/my-project
npx @aman_asmuei/acore        # Creates .acore/context.md with detected stack
aman-agent                     # Loads project context automatically
```

**What gets scoped to your project:**
- Decisions and topology (stored in amem with `project:my-project` scope)
- Session state (saved to `.acore/context.md` on exit)
- Plans (stored in `.acore/plans/`)

**Switch projects naturally:**

```bash
cd ~/project-a && aman-agent   # Loads project-a context + memories
cd ~/project-b && aman-agent   # Loads project-b context + memories
```

Global preferences (coding style, tool choices) carry across all projects.

</details>

<details>
<summary><strong>Personality & Wellbeing</strong></summary>

### Personality & Wellbeing

The agent adapts its tone based on time of day and how you're doing:

- **Morning:** energetic, direct
- **Afternoon:** steady, focused
- **Evening:** warm, winding down
- **Late night:** gentle, reflective

It also reads your messages for frustration, confusion, or fatigue — and adapts:

```
You > ugh nothing works, tried everything!!

  [sentiment: frustrated]

 Aman ──────────────────────────────────────────────
  That sounds frustrating. Let's step back and try a different
  angle — what changed since it last worked?
```

**Wellbeing nudges** appear when needed:
- Long late-night session → gentle suggestion to rest
- 90+ minutes of frustration → suggest a break
- User seems tired → concise responses, support wrapping up

These are one-time nudges — the agent won't nag.

</details>

<details>
<summary><strong>Customization</strong></summary>

### Customization

**Persona presets** for different work styles:

```bash
aman-agent init
# Choose: Coding Partner, Creative Collaborator,
#          Personal Assistant, Learning Buddy, or Minimal
```

**Guardrails** control what the AI should and shouldn't do:

```
/rules add Coding Always write tests before merging
/rules add Never Delete production data without confirmation
```

**Workflows** teach the AI multi-step processes:

```
/workflows add code-review
```

**Hook toggles** in `~/.aman-agent/config.json`:

```json
{
  "hooks": {
    "memoryRecall": true,
    "personalityAdapt": true,
    "extractMemories": true,
    "featureHints": true
  }
}
```

Set any to `false` to disable.

</details>

<details>
<summary><strong>Showcase Templates</strong></summary>

### Showcase Templates

Give your companion a pre-built specialty from [aman-showcase](https://github.com/amanasmuei/aman-showcase):

| Template | What it does |
|:---|:---|
| **Muslim** | Islamic daily companion — prayer times, hadith, du'a |
| **Quran** | Quranic Arabic vocabulary with transliteration |
| **Fitness** | Personal trainer — workout tracking, nutrition |
| **Freelancer** | Client & invoice tracking for independents |
| **Kedai** | Small business assistant (BM/EN) |
| **Money** | Personal finance & budget tracker |
| **Monitor** | Price/website/keyword watchdog |
| **Bahasa** | Malay/English language tutor |
| **Team** | Standups, tasks, team memory |
| **Rutin** | Medication reminders for family |
| **Support** | Customer support with escalation |
| **IoT** | Sensor monitoring for smart homes |
| **Feed** | News aggregation & filtering |

Install during onboarding or anytime:

```bash
npx @aman_asmuei/aman-showcase install muslim
```

Each template includes identity, workflows, rules, and domain skills — all installed into your ecosystem.

</details>

<details>
<summary><strong>Your Profile vs Agent Profiles</strong></summary>

### Your Profile vs Agent Profiles

**Your profile** is who YOU are — name, role, expertise, communication style. Set during onboarding, injected into every conversation:

```
/profile me            View your profile
/profile edit          Edit a field
/profile setup         Re-run full setup
```

**Agent profiles** are different AI personalities for different tasks:

```bash
aman-agent --profile coder      # direct, code-first
aman-agent --profile writer     # creative, story-driven
aman-agent --profile researcher # analytical, citation-focused
```

Each agent profile has its own identity, rules, and skills — but shares the same memory. Create profiles:

```
/profile create coder       Install built-in template
/profile create mybot       Create custom profile
/profile list               Show all profiles
```

</details>

<details>
<summary><strong>Agent Delegation</strong></summary>

### Agent Delegation

Delegate tasks to sub-agents with specialist profiles:

```
/delegate writer Write a blog post about AI companions

  [delegating to writer...]

  [writer] ✓ (2 tool turns)
  # Building AI Companions That Actually Remember You
  ...
```

**Pipeline delegation** — chain agents sequentially:

```
/delegate pipeline writer,researcher Write and fact-check an article

  [writer] ✓ — drafted article
  [researcher] ✓ — verified claims, added citations
```

The AI also **auto-suggests delegation** when it recognizes a task matches a specialist profile — always asks for your permission first.

</details>

<details>
<summary><strong>Agent Teams</strong></summary>

### Agent Teams

Named teams of agents that collaborate on complex tasks:

```
/team create content-team        Install built-in team
/team run content-team Write a blog post about AI

  Team: content-team (pipeline)
  Members: writer → researcher

  [writer: drafting...] ✓
  [researcher: fact-checking...] ✓

  Final output with verified claims.
```

**3 execution modes:**

| Mode | How it works |
|:---|:---|
| `pipeline` | Sequential: agent1 → agent2 → agent3 |
| `parallel` | All agents work concurrently, coordinator merges |
| `coordinator` | AI plans how to split the task, assigns to members |

**Built-in teams:**

| Team | Mode | Members |
|:---|:---|:---|
| `content-team` | pipeline | writer → researcher |
| `dev-team` | pipeline | coder → researcher |
| `research-team` | pipeline | researcher → writer |

Create custom teams:

```
/team create review-squad pipeline coder:implement,researcher:review
/team run review-squad Build a rate limiter in TypeScript
```

The AI auto-suggests teams when appropriate — always asks permission first.

</details>

<details>
<summary><strong>Session Telemetry & Post-Mortems</strong> (new in v0.24)</summary>

### Session Telemetry & Post-Mortems

aman-agent now passively observes what happens during a session and can produce a structured post-mortem on demand or automatically.

**Live observation dashboard:**

```
You > /observe

  Session: 47 min | Tools: 23 calls (2 errors) | Files: 5 changed
  Blockers: 1 | Milestones: 3 | Topic shifts: 2
```

**Pause / resume capture** when you don't want noisy commands recorded:

```
You > /observe pause
  Observation paused. Use /observe resume to continue.
```

**Generate a post-mortem on demand:**

```
You > /postmortem

  # Post-Mortem: 2026-04-11
  **Session:** session-2026-04-11-2143 | **Duration:** 47 min | **Turns:** 23

  ## Summary
  Refactored the auth middleware and shipped JWT validation...

  ## Completed
  - [x] Extracted token handler
  - [x] Wired rate limiter

  ## Blockers
  - Rate limit hit on token endpoint mid-session

  ## Patterns
  - Detect rate limits earlier
  ...

  Saved → ~/.acore/postmortems/2026-04-11-sess.md
```

**Automatic on session end** when any of these triggers fire:
- ≥3 tool errors
- ≥2 user blockers
- &gt;60 minute session
- Plan steps abandoned
- Sustained frustration (5+ frustration signals)

Recurring patterns from the report are stored as `pattern` memories so the next session benefits.

**Cross-session trends:**

```
/postmortem --since 7d   Analyze the last 7 days of post-mortems
/postmortem last         Show the most recent report
/postmortem list         List all saved post-mortems
```

**Storage:** `~/.acore/observations/*.jsonl` (raw events) and `~/.acore/postmortems/*.md` (reports). Old observations auto-prune after 30 days. Disable with `recordObservations: false` or `autoPostmortem: false` in config.

</details>

<details>
<summary><strong>Daily Workflow Summary</strong></summary>

### Daily Workflow Summary

Here's what a typical day looks like with aman-agent:

```
Morning:
  $ cd ~/project && aman-agent
  → Loads project context, active plan, memories
  → "Welcome back. You're on step 3 of Auth API."
  → Work on your plan, skills auto-activate as needed
  → /plan done after each step, commit your work

Afternoon:
  → Personality shifts to steady pace
  → Skills level up as you demonstrate mastery
  → Knowledge library suggests snippets when relevant

Evening:
  → /quit or Ctrl+C
  → Session auto-saved to memory
  → Project context.md updated
  → Plan progress persisted
  → Optional quick session rating

Next morning:
  → Everything picks up where you left off
```

</details>

---

## Features

### Intelligent Companion Features

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

### Silent Memory Extraction

After every response, the agent analyzes the conversation and extracts memories worth keeping — preferences, facts, patterns, decisions, corrections, and topology are all stored automatically. No confirmation prompts interrupting your flow.

```
You > I think we should go with microservices for the payment system

Aman > That makes sense given the compliance isolation requirements...

  [1 memory stored]
```

Don't want something remembered? Use `/memory search` to find it and `/memory clear` to remove it.

### Rich Terminal Output

Responses are rendered with full markdown formatting — **bold**, *italic*, `code`, code blocks, tables, lists, and headings all display beautifully in your terminal. Responses are framed with visual dividers:

```
 Aman ──────────────────────────────────────────────

  Here's how to set up Docker for this project...

 ──────────────────────────────── memories: ~45 tokens
```

### First-Run & Returning Greeting

**First session:** Your companion introduces itself and asks your name — the relationship starts naturally.

**Returning sessions:** A warm one-liner greets you with context from your last conversation:

```
  Welcome back. Last time we talked about your Duit Raya tracker.
  Reminder: Submit PR for auth refactor (due today)
```

### Progressive Feature Discovery

aman-agent surfaces tips about features you haven't tried yet, at the right moment:

```
  Tip: Teach me multi-step processes with /workflows add
```

One hint per session, never repeated. Disable with `hooks.featureHints: false`.

### Human-Readable Errors

No more cryptic API errors. Every known error maps to an actionable message:

```
  API key invalid. Run /reconfig to fix.
  Rate limited. I'll retry automatically.
  Network error. Check your internet connection.
```

Failed messages are preserved — just press Enter to retry naturally.

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

### Personality Engine

The agent adapts its personality in real-time based on signals:

- **Time of day**: morning (high-drive) → afternoon (steady) → night (reflective)
- **Session duration**: gradually shifts from energetic to mellow
- **User sentiment**: detects frustration, excitement, confusion, fatigue from keywords
- **Wellbeing nudges**: suggests breaks when you've been at it too long, gently mentions sleep during late-night sessions

All state syncs to acore's Dynamics section — works across aman-agent, achannel, and aman-claude-code.

### Auto-Triggered Skills

When you talk about security, the security skill activates. Debugging? The debugging skill loads. No commands needed.

- 12 skill domains with keyword matching
- **Skill leveling** (Lv.1→Lv.5): adapts explanation depth to your demonstrated mastery
- **Self-improving**: memory extraction enriches skills with your specific patterns over time
- **Knowledge library**: 10 curated reference items auto-suggested when relevant

### Persistent Plans

Create multi-step plans that survive session resets:

```
/plan create Auth | Add JWT auth | Design schema, Implement middleware, Add tests, Deploy

Plan: Auth (active)
Goal: Add JWT auth
Progress: [████████░░░░░░░░░░░░] 2/5 (40%)

   1. [✓] Design schema
   2. [✓] Implement middleware
   3. [ ] Add tests         ← Next
   4. [ ] Deploy
```

Plans stored as markdown in `.acore/plans/` — git-trackable, project-local.

### Background Task Execution

Long-running tools (tests, builds, Docker) run in the background while the conversation continues. Results appear when ready.

### Project-Aware Sessions

The agent detects your project from the current directory. On exit, it auto-updates `.acore/context.md` with session state. Next time you open the same project, the AI picks up where you left off.

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

### Passive Session Observation

Every tool call, error, file change, sentiment shift, blocker, milestone, and topic shift is captured as a typed event and written to `~/.acore/observations/*.jsonl`. Capture is non-blocking (events buffer in memory and flush in batches). Stats are visible live via `/observe`.

### LLM-Powered Post-Mortems

On session end, if any smart trigger fires (≥3 tool errors, ≥2 blockers, &gt;60 min, abandoned plan steps, or sustained frustration), the agent uses your LLM to generate a structured post-mortem report — summary, goals, completed work, blockers, decisions, sentiment arc, recurring patterns, and actionable recommendations. Patterns are stored back as `pattern` memories. Reports persist as markdown in `~/.acore/postmortems/`.

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
│   │    - All types auto-stored silently             │     │
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
| **Start** | Load ecosystem, connect MCP, consolidate memory, check reminders, compute personality state, load active plan |
| **Each turn** | Recall memories, auto-trigger skills, inject active plan, detect sentiment, stream response, execute tools (parallel + background), extract memories, enrich skills |
| **Every 5 turns** | Refresh personality state, check wellbeing, sync to acore |
| **Auto-trim** | LLM-powered summarization when approaching 80K tokens |
| **Exit** | Save conversation to amem, update session resume, persist personality state, update project context.md, optional session rating |

---

## Commands

| Command | Description |
|:---|:---|
| `/help` | Show available commands |
| `/plan` | Show active plan `[create\|done\|undo\|list\|switch\|show]` |
| `/profile` | Your profile + agent profiles `[me\|edit\|setup\|create\|list\|show\|delete]` |
| `/delegate` | Delegate task to a profile `[<profile> <task>\|pipeline]` |
| `/team` | Manage agent teams `[create\|run\|list\|show\|delete]` |
| `/identity` | View identity `[update <section>]` |
| `/rules` | View guardrails `[add\|remove\|toggle ...]` |
| `/workflows` | View workflows `[add\|remove ...]` |
| `/tools` | View tools `[add\|remove ...]` |
| `/skills` | View skills `[install\|uninstall ...]` |
| `/eval` | View evaluation `[milestone ...]` |
| `/memory` | View memories `[search\|clear\|timeline]` |
| `/observe` | Live session telemetry dashboard `[pause\|resume]` |
| `/postmortem` | Generate session post-mortem `[last\|list\|--since 7d]` |
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
| **User** | `~/.acore/user.md` | Your name, role, expertise level, communication style |
| **Memory** | `~/.amem/memory.db` | Past decisions, corrections, patterns, conversation history |
| **Reminders** | `~/.amem/memory.db` | Overdue, today, and upcoming reminders |
| **Tools** | `~/.akit/kit.md` | Available capabilities (GitHub, search, databases) |
| **Workflows** | `~/.aflow/flow.md` | Multi-step processes (code review, bug fix) |
| **Guardrails** | `~/.arules/rules.md` | Safety boundaries and permissions |
| **Skills** | `~/.askill/skills.md` | Deep domain expertise |
| **Plans** | `.acore/plans/` | Active plan with progress and next step |
| **Project** | `.acore/context.md` | Project-specific tech stack, session state, patterns |
| **Time** | System clock | Time of day, day of week for tone and personality adaptation |

All layers are optional — the agent works with whatever you've set up.

### Token Budgeting

Layers are included by priority when space is limited:

```
Identity (always) → User (always) → Guardrails → Workflows → Tools → Skills (can truncate)
```

Default budget: 8,000 tokens. Override with `--budget`.

---

## Supported LLMs

| Provider | Models | Tool Use | Streaming |
|:---|:---|:---|:---|
| **Anthropic** | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 | Full | Full (with tools) |
| **OpenAI** | GPT-4o, GPT-4o Mini, o3 | Full | Full (with tools) |
| **Ollama** | Llama, Mistral, Gemma, any local model | Model-dependent | Full (with tools) |

### Image Support (Vision)

Reference image files or URLs in your message and they'll be sent as vision content to the LLM:

```
You > What's in this screenshot? ~/Desktop/screenshot.png
  [attached image: screenshot.png (245.3KB)]
```

**Supported formats:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`

**Image URLs** are also supported — paste any `https://...png` URL and it will be fetched and attached.

**Multiple files** can be referenced in a single message (images, text files, and documents together).

**Size limit:** 20MB per image.

**Vision model requirements:**
| Provider | Vision Models |
|:---|:---|
| **Anthropic** | All Claude models (Sonnet, Opus, Haiku) |
| **OpenAI** | GPT-4o, GPT-4o Mini |
| **Ollama** | LLaVA, Llama 3.2 Vision, Moondream, BakLLaVA |

Non-vision models will receive the image but may not be able to interpret it.

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
    "extractMemories": true,
    "featureHints": true,
    "personalityAdapt": true,
    "recordObservations": true,
    "autoPostmortem": true
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
| `featureHints` | Show progressive feature discovery tips |
| `personalityAdapt` | Adapt tone based on time, sentiment, and session signals |
| `recordObservations` | Capture passive session telemetry to JSONL |
| `autoPostmortem` | Auto-generate post-mortem on session end (smart trigger) |

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
| Learns from conversation | Auto-extract (silent) + skill enrichment | Requires configuration | No |
| Personality adaptation | Sentiment-aware, time-based, energy curve | None | None |
| Wellbeing awareness | 6 nudge types (sleep, breaks, frustration) | None | None |
| Skill leveling | Lv.1→Lv.5, auto-triggered by context | None | None |
| Plan tracking | Persistent checkboxes, survives resets | None | None |
| Vision / multimodal | Images via base64 (local + URL) | None | None |
| Background tasks | Long-running tools run concurrently | None | None |
| Guardrail enforcement | Runtime tool blocking | None | None |
| Reminders | Persistent, deadline-aware | None | None |
| Context compression | LLM-powered summarization | Archival system | Truncation |
| Multi-LLM | Anthropic, OpenAI, Ollama (all with tools) | OpenAI-focused | Single provider |
| Tool execution | Parallel + background with guardrails | Sequential | None |
| Project awareness | Auto-detect project, scoped memory, context.md | None | None |

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

## FAQ

<details>
<summary><strong>Is my data sent anywhere?</strong></summary>

No. All memory, observations, and post-mortems live in your local filesystem (`~/.acore`, `~/.amem`, `~/.aman-agent`). The only data leaving your machine is what you send to your chosen LLM provider — and you control that with your own API key.

</details>

<details>
<summary><strong>Can I use this without Claude?</strong></summary>

Yes. aman-agent supports Anthropic, OpenAI, Ollama (local), GitHub Copilot, and the Claude Code CLI as authentication backends. Anything that speaks tool use will work — see [Supported LLMs](#supported-llms).

</details>

<details>
<summary><strong>How is this different from Claude Code's memory or `mem0`?</strong></summary>

Claude Code's memory is markdown read at startup — no per-message recall, no learning. `mem0` is a cloud vector DB focused on OpenAI. **amem** (the memory layer aman-agent uses) is local SQLite + embeddings + a knowledge graph, with typed memories, progressive disclosure (~10x token savings), reminders, and consolidation. See [the comparison table](#what-makes-this-different).

</details>

<details>
<summary><strong>What does "progressive disclosure" mean for memory?</strong></summary>

Instead of injecting full memory content (~500-1000 tokens) on every recall, the agent injects a compact index (~50-100 tokens) with IDs and previews. The LLM can then call `memory_detail` with specific IDs if it needs full content. Result: ~10x token savings on most turns.

</details>

<details>
<summary><strong>How do I disable post-mortems / observations?</strong></summary>

Set `recordObservations: false` and/or `autoPostmortem: false` in `~/.aman-agent/config.json`. You can still generate post-mortems on demand with `/postmortem` even if auto-trigger is off.

</details>

<details>
<summary><strong>Does this work in CI / non-interactive mode?</strong></summary>

aman-agent is primarily an interactive REPL. For programmatic use, the underlying packages (`@aman_asmuei/amem`, `acore-core`, `arules-core`) are available as standalone Node libraries.

</details>

<details>
<summary><strong>I'm getting "MCP error -32000: Connection closed"</strong></summary>

This usually means an MCP server crashed on startup. Run `npx @aman_asmuei/aman-mcp` directly to see the underlying error. The most common cause is a stale package install — try `rm -rf ~/.npm/_npx && npx @aman_asmuei/aman-agent`.

</details>

---

## Contributing

```bash
git clone https://github.com/amanasmuei/aman-agent.git
cd aman-agent && npm install
npm run build   # zero errors
npm test        # 304 tests pass
```

PRs welcome. See [Issues](https://github.com/amanasmuei/aman-agent/issues).

**Project standards:**
- All new modules ship with tests (TDD encouraged)
- Type errors block merge — `npm run build` must be clean
- Commits follow conventional format (`feat:`, `fix:`, `chore:`, `docs:`)

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
