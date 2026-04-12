#!/usr/bin/env bash
# aman-agent v0.39.0 — Universal Master Orchestrator Demo
# 5 scenes: Install → Memory → Orchestrate → GitHub → Wellbeing
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
P='\033[0;35m'    # purple

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
# ║  SCENE 1: Install & First Run                            ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 1${R}  ${B}Install & First Run${R}\n"
div
p 1

printf "\n  ${D}\$${R} "
t "curl -fsSL https://raw.githubusercontent.com/amanasmuei/aman-agent/main/install.sh | bash"
printf "\n"
p 0.6

printf "\n  ${G}✓${R} Downloaded aman-agent v0.39.0\n"
p 0.2
printf "  ${G}✓${R} Installed to ~/.local/bin/aman-agent\n"
p 0.4

printf "\n  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.5

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.2
printf "\n  ${BL}◇${R}  LLM provider\n"
printf "  ${G}●${R}  Claude (Anthropic)       ${D}— recommended${R}\n"
printf "  ${D}○${R}  GitHub Copilot           ${D}— uses GitHub Models${R}\n"
printf "  ${D}○${R}  GPT (OpenAI)\n"
printf "  ${D}○${R}  Ollama (local)           ${D}— free, runs offline${R}\n"
p 0.8

printf "\n  ${G}✓${R} Config saved  ${D}~/.aman-agent/config.json${R}\n"
p 0.2
printf "  ${G}✓${R} Ecosystem loaded ${D}(identity, guardrails, 30 MCP tools)${R}\n"
p 0.2
printf "  ${G}✓${R} Memory: 0 memories ${D}(fresh start)${R}\n"
p 0.2
printf "  ${G}${B}Aman${R}${G} is ready.${R} Model: claude-sonnet-4-6\n"
p 0.8

printf "\n${G}You > ${R}"
p 0.3
t "Hey, I'm building a Node.js API with PostgreSQL"
printf "\n"
p 0.5

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  Hey! I'll remember that. What kind of API — REST, GraphQL?"
printf "\n"
ts "  I can help with architecture, auth, or database design."
printf "\n"
adiv
p 0.2
printf "${D}  [2 memories stored: fact — Node.js API, decision — PostgreSQL]${R}\n"
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 2: Memory + Dev Mode                              ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 2${R}  ${B}Next Day — Memory + Dev Mode${R}\n"
div
p 1

printf "\n  ${D}\$${R} "
t "aman-agent dev ~/projects/my-api"
printf "\n"
p 0.6

printf "\n"
printf "  ${B}aman agent dev${R}\n"
p 0.2
printf "  Detected: ${G}Node.js (Express)${R} + ${G}PostgreSQL${R} + ${G}Docker${R} + ${G}GitHub Actions${R}\n"
p 0.3
printf "  Recalled: ${C}6 memories${R} ${D}(2 decisions, 3 facts, 1 preference)${R}\n"
p 0.3
printf "  ${G}✓${R} CLAUDE.md written ${D}(template mode)${R}\n"
p 0.2
printf "  ${G}✓${R} Launching Claude Code...\n"
p 1

printf "\n  ${D}─── later, in aman-agent chat ───${R}\n"
p 0.5

printf "\n${G}You > ${R}"
p 0.3
t "Let's add auth endpoints"
printf "\n"
p 0.4

printf "\n  ${D}[memories: ~52 tokens]${R}\n"
printf "  ${D}[skill: api-design Lv.3 activated]${R}\n"
p 0.2

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  Based on our decisions: **JWT with RS256**, **PostgreSQL** via"
printf "\n"
ts "  Prisma, rate limiting on auth. I'll scaffold login + register."
printf "\n"
adiv
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 3: Task Orchestration — THE HEADLINE              ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 3${R}  ${B}Task Orchestration — Multi-Agent Workflows${R}\n"
div
p 1

printf "\n${G}You > ${R}"
p 0.3
t "/orchestrate Build user authentication with JWT, password hashing, rate limiting, and tests"
printf "\n"
p 0.6

printf "\n  ${D}Decomposing requirement into task DAG...${R}\n"
p 0.8

printf "\n  ${B}## User Authentication${R}\n"
printf "  ${B}Goal:${R} JWT auth with security hardening\n"
printf "  ${B}Tasks:${R} 5 | ${B}Gates:${R} 1\n\n"
p 0.3
printf "  ${P}●${R} ${B}Design auth architecture${R} ${D}→ architect [advanced] (root)${R}\n"
p 0.15
printf "  ${P}●${R} ${B}Implement JWT middleware${R} ${D}→ coder [standard] (after: design)${R}\n"
p 0.15
printf "  ${P}●${R} ${B}Add rate limiting${R}        ${D}→ coder [standard] (after: design)${R}\n"
p 0.15
printf "  ${P}●${R} ${B}Write test suite${R}         ${D}→ tester [standard] (after: jwt, rate-limit)${R}\n"
p 0.15
printf "  ${P}●${R} ${B}Security review${R}          ${D}→ security [standard] (after: tests)${R}\n"
p 0.15
printf "  ${Y}🔒${R} ${B}Human approval${R}           ${D}[approval gate]${R}\n"
p 1

printf "\n  ${D}Executing DAG (max parallel: 4)...${R}\n"
p 0.5
printf "  ${G}✓${R} Design auth architecture ${D}(architect, 3 turns)${R}\n"
p 0.3
printf "  ${G}▶${R} JWT middleware ${D}+ ${G}▶${R} Rate limiting ${D}(running in parallel)${R}\n"
p 0.6
printf "  ${G}✓${R} Implement JWT middleware ${D}(coder, 5 turns)${R}\n"
p 0.2
printf "  ${G}✓${R} Add rate limiting ${D}(coder, 4 turns)${R}\n"
p 0.3
printf "  ${G}✓${R} Write test suite ${D}(tester, 6 turns)${R}\n"
p 0.3
printf "  ${G}✓${R} Security review ${D}(security, 2 turns)${R}\n"
p 0.3
printf "  ${Y}⏸${R}  Waiting for human approval...\n"
p 1

printf "\n${G}You > ${R}"
p 0.3
t "approve"
printf "\n"
p 0.3

printf "\n  ${G}✓${R} Orchestration complete ${D}(5 tasks, 20 turns, 34.2s)${R}\n"
printf "  ${D}Cost: ~\$0.12 (3 standard + 1 advanced + 1 fast tier)${R}\n"
printf "  ${D}Audit: 18 events logged${R}\n"
p 2.5

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 4: GitHub + Teams                                 ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 4${R}  ${B}GitHub-Native + Agent Teams${R}\n"
div
p 1

printf "\n${G}You > ${R}"
p 0.3
t "/github plan 42"
printf "\n"
p 0.5

printf "\n  Fetching issue ${C}#42: \"Add OAuth2 login\"${R}...\n"
p 0.4
printf "  Decomposing into task DAG...\n"
p 0.5

printf "\n  ${B}## Add OAuth2 login${R}\n"
printf "  ${B}Tasks:${R} 4 | ${B}Gates:${R} 1\n"
printf "  ${P}●${R} Design OAuth flow ${D}→ architect${R}\n"
printf "  ${P}●${R} Implement provider ${D}→ coder${R}\n"
printf "  ${P}●${R} Write tests ${D}→ tester${R}\n"
printf "  ${P}●${R} Security audit ${D}→ security${R}\n"
p 1.2

printf "\n${G}You > ${R}"
p 0.3
t "/github ci main"
printf "\n"
p 0.3
printf "\n  CI Status: ${G}✓ passing${R} ${D}(ci.yml, 3m ago)${R}\n"
p 0.8

printf "\n${G}You > ${R}"
p 0.3
t "/delegate @coder Refactor src/auth.ts to use async/await"
printf "\n"
p 0.4

printf "\n  ${D}[delegating to @coder via A2A...]${R}\n"
p 0.6
printf "  ${G}✓${R} @coder completed ${D}(4 turns, 8.2s)${R}\n"
p 0.3

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  Refactored — 12 callbacks converted to async/await."
printf "\n"
ts "  All existing tests still pass."
printf "\n"
adiv
p 2

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 5: Late Night + Wellbeing + Exit                  ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 5${R}  ${B}Late Night — An AI That Cares${R}\n"
div
p 1

printf "\n  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.4

printf "\n  ${G}✓${R} Personality: ${M}late-night, reflective${R}\n"
p 0.2
printf "  ${D}Welcome back. Your auth orchestration completed earlier —${R}\n"
printf "  ${D}all 5 tasks passed, security review clean.${R}\n"
p 1

printf "\n${G}You > ${R}"
p 0.3
t "ugh the deploy keeps failing, tried everything"
printf "\n"
p 0.3
printf "  ${D}[sentiment: frustrated]${R}\n"
p 0.4

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  That's frustrating. Let's try a different angle — check"
printf "\n"
ts "  if the build artifact is correct before the deploy config."
printf "\n"
adiv
p 1

printf "\n${G}You > ${R}"
p 0.3
t "same error, been at this for 2 hours"
printf "\n"
p 0.4

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n\n"
ts "  It's past 1am. Fresh eyes in the morning genuinely solve"
printf "\n"
ts "  what late-night persistence can't. Save and sleep on it."
printf "\n"
adiv
p 0.2
printf "${D}  [wellbeing: sleep nudge]${R}\n"
p 1.5

printf "\n${G}You > ${R}"
p 0.3
t "/quit"
printf "\n"
p 0.3
printf "\n  ${D}Saving 18 messages to memory...${R}\n"
p 0.2
printf "  ${D}Post-mortem generated (2 patterns saved as skills)${R}\n"
p 0.2
printf "  ${D}Goodbye.${R}\n"
p 2.5

# ╔═══════════════════════════════════════════════════════════╗
# ║  End Card                                                ║
# ╚═══════════════════════════════════════════════════════════╝

clear
printf "\n\n"
printf "  ${B}aman-agent${R} ${D}v0.39.0${R}\n"
printf "  ${D}The AI companion that remembers you —${R}\n"
printf "  ${D}and orchestrates your entire dev workflow.${R}\n"
printf "\n"
printf "  ${G}npx @aman_asmuei/aman-agent${R}\n"
printf "\n"
printf "  ${W}${B}What it does:${R}\n\n"
printf "  ${P}●${R} Task orchestration     ${P}●${R} Multi-agent DAG scheduler\n"
printf "  ${P}●${R} GitHub-native          ${P}●${R} Issue → plan → PR pipeline\n"
printf "  ${P}●${R} 4 specialist agents    ${P}●${R} Architect, Security, Tester, Reviewer\n"
printf "  ${P}●${R} Persistent memory      ${P}●${R} Per-message recall + extraction\n"
printf "  ${P}●${R} Adaptive personality   ${P}●${R} Sentiment + wellbeing nudges\n"
printf "  ${P}●${R} Skill auto-leveling    ${P}●${R} Learning → Expert (Lv.1→5)\n"
printf "  ${P}●${R} Plan tracking          ${P}●${R} Project-aware sessions\n"
printf "  ${P}●${R} Circuit breakers       ${P}●${R} Cost tracking + budget enforcement\n"
printf "  ${P}●${R} 6 LLM providers        ${P}●${R} Claude, GPT, Copilot, Ollama\n"
printf "\n"
printf "  ${D}867 tests | MIT Licensed | github.com/amanasmuei/aman-agent${R}\n"
printf "\n\n"
p 5
