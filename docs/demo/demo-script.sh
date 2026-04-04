#!/usr/bin/env bash
# aman-agent v0.13.0 — Comprehensive Demo
# 5 scenes covering ALL features
#
# Record: vhs docs/demo/demo.tape

set -e

# ── Colors ──
C='\033[0;36m'    # cyan
G='\033[0;32m'    # green
Y='\033[0;33m'    # yellow
D='\033[2m'       # dim
B='\033[1m'       # bold
R='\033[0m'       # reset
W='\033[37m'      # white
M='\033[0;35m'    # magenta
RED='\033[0;31m'  # red
BL='\033[0;34m'   # blue

t() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.03
  done
}

ts() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.018
  done
}

p() { sleep "${1:-1}"; }

div() {
  printf "${D}────────────────────────────────────────────────────────────${R}\n"
}

adiv() {
  printf "${D} ──────────────────────────────────────────────────────────${R}\n"
}

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 1: First Run — Install, Auto-Detect, First Chat  ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 1${R}  ${B}First Run — Choose Your Provider${R}\n"
div
p 1.2

printf "\n  ${D}\$${R} "
t "npx @aman_asmuei/aman-agent"
printf "\n"
p 0.8

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.3
printf "\n  ${BL}●${R}  First-time setup — configure your LLM connection.\n"
p 0.4

printf "\n  ${BL}◇${R}  LLM provider\n"
printf "  ${G}●${R}  Claude (Anthropic)       ${D}— recommended${R}\n"
printf "  ${D}○${R}  GitHub Copilot           ${D}— uses GitHub Models${R}\n"
printf "  ${D}○${R}  GPT (OpenAI)\n"
printf "  ${D}○${R}  Ollama (local)           ${D}— free, runs offline${R}\n"
p 1

printf "\n  ${G}✓${R} Claude Code CLI detected.\n"
p 0.3
printf "\n  ${BL}◇${R}  Authentication\n"
printf "  ${G}●${R}  Already logged in to Claude Code\n"
printf "  ${D}○${R}  Log in now               ${D}— runs: claude login${R}\n"
p 0.6

printf "\n  ${BL}◇${R}  Claude model\n"
printf "  ${G}●${R}  Claude Sonnet 4.6        ${D}— fast, recommended${R}\n"
printf "  ${D}○${R}  Claude Opus 4.6          ${D}— most capable${R}\n"
printf "  ${D}○${R}  Claude Haiku 4.5         ${D}— fastest${R}\n"
p 0.8

printf "\n  ${G}✓${R} Config saved to ~/.aman-agent/config.json\n"
p 0.3
printf "  ${G}✓${R} Ecosystem: identity, guardrails ${D}(1,204 tokens)${R}\n"
p 0.25
printf "  ${G}✓${R} Connected 30 MCP tools\n"
p 0.25
printf "  ${G}✓${R} Personality: ${D}morning, high-drive energy${R}\n"
p 0.25
printf "  ${G}${B}Aman${R}${G} is ready.${R} Type /help for commands.\n"
p 0.8

# First conversation — agent introduces itself
printf "\n${G}You > ${R}"
p 0.4
t "Hey, I'm building a Node.js API"
printf "\n"
p 0.6

printf "\n  ${D}[skill: api-design Lv.1 activated]${R}\n"
p 0.2

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
p 0.2
ts "  Hey! I'm Aman — I'll remember our conversations and grow"
printf "\n"
ts "  with you over time. What kind of API are you building?"
printf "\n"
ts "  I can help with architecture, auth, database design —"
printf "\n"
ts "  whatever you need."
printf "\n"
adiv
p 0.2
printf "${D}  [1 memory stored: fact — user building Node.js API]${R}\n"
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 2: Returning User — Memory, Files, Images        ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 2${R}  ${B}Returning User — Memory + Files + Images${R}\n"
div
p 1.2

printf "\n  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.6

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.25
printf "  ${G}✓${R} Ecosystem: identity, guardrails, workflows, 5 skills ${D}(3,124 tokens)${R}\n"
p 0.25
printf "  ${G}✓${R} Memory health: 96%% (142 memories)\n"
p 0.25
printf "  ${G}✓${R} Personality: ${D}afternoon, steady energy${R}\n"
p 0.25
printf "  ${G}${B}Aman${R}${G} is ready.${R}\n"
p 0.3

# Returning greeting + reminders
printf "\n  ${D}Welcome back. Last time we designed the JWT auth schema.${R}\n"
printf "  ${Y}⏰ Reminder: Write integration tests for auth (due today)${R}\n"
p 1.2

# Memory recall in action
printf "\n${G}You > ${R}"
p 0.3
t "Let's set up the auth endpoints"
printf "\n"
p 0.5

printf "\n  ${D}[skill: api-design Lv.2 activated]${R}\n"
printf "  ${D}[skill: security Lv.2 activated]${R}\n"
p 0.2

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
p 0.2
ts "  Based on our previous decisions:"
printf "\n"
ts "  - Auth: **JWT with RS256** + refresh token rotation"
printf "\n"
ts "  - Database: **PostgreSQL** with Prisma ORM"
printf "\n"
ts "  - Rate limiting on auth endpoints"
printf "\n\n"
ts "  I'll scaffold the login and register endpoints..."
printf "\n"
adiv
p 0.2
printf "${D}  memories: ~52 tokens${R}\n"
p 1.2

# File attachment
printf "\n${G}You > ${R}"
p 0.3
t "Check this middleware ~/project/src/auth.ts"
printf "\n"
p 0.2
printf "  ${D}[attached: auth.ts (4.1KB)]${R}\n"
p 0.4

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  Your middleware looks solid. Two things:"
printf "\n"
ts "  - Line 23: add token expiry check before decode"
printf "\n"
ts "  - Line 41: the error handler leaks internal details"
printf "\n"
adiv
p 1

# Image attachment
printf "\n${G}You > ${R}"
p 0.3
t "How about this schema? ~/Desktop/db-schema.png"
printf "\n"
p 0.2
printf "  ${D}[attached image: db-schema.png (187.3KB)]${R}\n"
printf "  ${D}[skill: database Lv.3 activated]${R}\n"
p 0.4

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  The schema looks good. Add an index on"
printf "\n"
ts "  \`refresh_tokens.user_id\` — that'll be a hot query path."
printf "\n"
adiv
p 0.2
printf "${D}  [knowledge: prisma-setup suggested]${R}\n"
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 3: Plans, Workflows, Rules                       ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 3${R}  ${B}Plans, Workflows & Guardrails${R}\n"
div
p 1.2

# Create a plan
printf "\n${G}You > ${R}"
p 0.3
t "/plan create Auth API | Ship JWT auth | Design schema, Build endpoints, Write tests, Deploy"
printf "\n"
p 0.4

printf "\n  ${G}Plan created!${R}\n\n"
printf "  Plan: Auth API ${G}(active)${R}\n"
printf "  Goal: Ship JWT auth\n"
printf "  Progress: [${D}░░░░░░░░░░░░░░░░░░░░${R}] 0/4 (0%%)\n\n"
printf "   1. [ ] Design schema\n"
printf "   2. [ ] Build endpoints\n"
printf "   3. [ ] Write tests\n"
printf "   4. [ ] Deploy\n\n"
printf "  Next: Step 1 — Design schema\n"
p 1.5

# Mark steps done
printf "\n${G}You > ${R}"
p 0.3
t "/plan done"
printf "\n"
p 0.3
printf "\n  ${G}Step 1 done!${R}\n"
printf "  Progress: [${G}█████${R}${D}░░░░░░░░░░░░░░░${R}] 1/4 (25%%)\n"
p 0.8

printf "\n${G}You > ${R}"
p 0.3
t "/plan done"
printf "\n"
p 0.3
printf "\n  ${G}Step 2 done!${R}\n"
printf "  Progress: [${G}██████████${R}${D}░░░░░░░░░░${R}] 2/4 (50%%)\n"
p 1

# Add a workflow
printf "\n${G}You > ${R}"
p 0.3
t "/workflows add deploy"
printf "\n"
p 0.4
printf "\n  ${G}✓${R} Workflow added: deploy\n"
printf "  ${D}Steps: Run tests → Build → Deploy staging → Smoke test → Deploy prod${R}\n"
p 1

# Add a rule
printf "\n${G}You > ${R}"
p 0.3
t "/rules add Coding Never push directly to main"
printf "\n"
p 0.3
printf "\n  ${G}✓${R} Rule added to Coding: Never push directly to main\n"
p 0.8

# Rules enforced
printf "\n${G}You > ${R}"
p 0.3
t "Push my changes to main branch"
printf "\n"
p 0.4

printf "\n  ${RED}[BLOCKED: Coding rule — Never push directly to main]${R}\n"
p 0.3

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  I can't push directly to main — your guardrails block it."
printf "\n"
ts "  Want me to create a PR instead?"
printf "\n"
adiv
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 4: Commands — Status, Memory, Eval, Skills       ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 4${R}  ${B}Ecosystem Commands${R}\n"
div
p 1.2

# /status
printf "\n${G}You > ${R}"
p 0.3
t "/status"
printf "\n"
p 0.3

printf "\n  ${B}Ecosystem Status${R}\n\n"
printf "  identity   ${G}●${R}  Aman          ${D}~/.acore/core.md${R}\n"
printf "  rules      ${G}●${R}  5 rules       ${D}~/.arules/rules.md${R}\n"
printf "  workflows  ${G}●${R}  3 workflows   ${D}~/.aflow/flow.md${R}\n"
printf "  tools      ${G}●${R}  45 MCP tools  ${D}~/.akit/kit.md${R}\n"
printf "  skills     ${G}●${R}  5 installed   ${D}~/.askill/skills.md${R}\n"
printf "  eval       ${G}●${R}  12 sessions   ${D}~/.aeval/eval.md${R}\n"
printf "  memory     ${G}●${R}  148 memories  ${D}~/.amem/memory.db${R}\n"
printf "  plan       ${G}●${R}  Auth API 2/4  ${D}.acore/plans/${R}\n"
p 1.5

# /memory search
printf "\n${G}You > ${R}"
p 0.3
t "/memory search auth decisions"
printf "\n"
p 0.3

printf "\n  ${B}Memory Search: auth decisions${R}\n\n"
printf "  ${G}92%%${R}  [decision] Auth uses JWT with RS256 + refresh rotation\n"
printf "  ${G}88%%${R}  [decision] PostgreSQL for user storage\n"
printf "  ${G}75%%${R}  [fact] Auth rewrite driven by compliance requirements\n"
printf "  ${G}71%%${R}  [preference] Always run integration tests before deploy\n"
p 1.2

# /eval
printf "\n${G}You > ${R}"
p 0.3
t "/eval"
printf "\n"
p 0.3

printf "\n  ${B}Relationship Metrics${R}\n\n"
printf "  Sessions: 12 | Trust: 4/5 | Trajectory: ${G}building${R}\n\n"
printf "  Recent:  ${G}★★★★★${R} ${G}★★★★☆${R} ${G}★★★★★${R} ${G}★★★★☆${R} ${G}★★★★★${R}\n"
printf "  Milestones: First proactive suggestion, First deployment\n"
p 1.2

# /skills (showing levels)
printf "\n${G}You > ${R}"
p 0.3
t "/skills"
printf "\n"
p 0.3

printf "\n  ${B}Skills${R} (installed)\n\n"
printf "  api-design    Lv.3 Proficient  ${D}(28 activations)${R}\n"
printf "  security      Lv.2 Familiar    ${D}(8 activations)${R}\n"
printf "  database      Lv.3 Proficient  ${D}(14 activations)${R}\n"
printf "  testing       Lv.1 Learning    ${D}(2 activations)${R}\n"
printf "  debugging     Lv.2 Familiar    ${D}(6 activations)${R}\n"
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 5: Late Night — Personality + Wellbeing + Exit    ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 5${R}  ${B}Late Night — An AI That Cares${R}\n"
div
p 1.2

printf "\n  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.6

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.25
printf "  ${G}✓${R} Personality: ${M}late-night, reflective energy${R}\n"
p 0.25
printf "  ${G}✓${R} Active plan: Auth API (3/4)\n"
p 0.25
printf "  ${G}${B}Aman${R}${G} is ready.${R}\n"
p 0.3
printf "\n  ${D}Welcome back. Step 4 of Auth API — Deploy.${R}\n"
p 1

# Frustrated user
printf "\n${G}You > ${R}"
p 0.3
t "ugh the deploy keeps failing, tried everything!!"
printf "\n"
p 0.3
printf "  ${D}[skill: debugging Lv.2 activated]${R}\n"
printf "  ${D}[sentiment: frustrated]${R}\n"
p 0.4

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  That's frustrating. Let's try a different angle — instead"
printf "\n"
ts "  of the deploy config, let's check if the build artifact"
printf "\n"
ts "  is actually correct first."
printf "\n"
adiv
p 1.2

# Continued frustration + late night = wellbeing nudge
printf "\n${G}You > ${R}"
p 0.3
t "same error, been at this for 2 hours"
printf "\n"
p 0.4

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  It's past 1am and you've been debugging for two hours."
printf "\n"
ts "  Fresh eyes in the morning genuinely solve what late-night"
printf "\n"
ts "  persistence can't. Save your progress and sleep on it —"
printf "\n"
ts "  the bug isn't going anywhere."
printf "\n"
adiv
p 0.3
printf "${D}  [wellbeing: sleep-frustrated nudge]${R}\n"
p 1.5

# Session exit
printf "\n${G}You > ${R}"
p 0.3
t "/quit"
printf "\n"
p 0.4

printf "\n  ${D}Saving conversation to memory...${R}\n"
p 0.3
printf "  ${D}Saved 24 messages (session: s-20260328-013042)${R}\n"
p 0.3
printf "  ${D}Updated project context (.acore/context.md)${R}\n"
p 0.3
printf "  ${D}Personality state synced to acore${R}\n"
p 0.3

printf "\n  Quick rating for this session?\n"
printf "  ${G}>${R} Good\n"
p 0.5
printf "  ${D}Rating saved.${R}\n"
p 0.3
printf "\n  ${D}Goodbye.${R}\n"
p 2.5

# ╔═══════════════════════════════════════════════════════════╗
# ║  End Card                                                ║
# ╚═══════════════════════════════════════════════════════════╝

clear
printf "\n\n"
printf "  ${B}aman-agent${R}\n"
printf "  ${D}The AI companion that actually remembers you.${R}\n"
printf "\n"
printf "  ${G}npx @aman_asmuei/aman-agent${R}\n"
printf "\n"
printf "  ${W}${B}Everything it does:${R}\n\n"
printf "  ${D}●${R} Persistent memory     ${D}●${R} Adaptive personality\n"
printf "  ${D}●${R} Skill auto-trigger    ${D}●${R} Skill leveling (Lv.1→5)\n"
printf "  ${D}●${R} Self-improving skills  ${D}●${R} Knowledge library\n"
printf "  ${D}●${R} Plan tracking          ${D}●${R} Project-aware sessions\n"
printf "  ${D}●${R} Image & file support   ${D}●${R} Background tasks\n"
printf "  ${D}●${R} Sentiment detection    ${D}●${R} Wellbeing nudges\n"
printf "  ${D}●${R} Guardrail enforcement  ${D}●${R} Workflow automation\n"
printf "  ${D}●${R} Memory consolidation   ${D}●${R} Reminders\n"
printf "  ${D}●${R} Multi-LLM support      ${D}●${R} Copilot + Claude Code CLI\n"
printf "\n"
printf "  ${D}Works with: Claude (via CLI), GitHub Copilot, OpenAI, Ollama${R}\n"
printf "  ${D}MIT Licensed  |  github.com/amanasmuei/aman-agent${R}\n"
printf "\n\n"
p 5
