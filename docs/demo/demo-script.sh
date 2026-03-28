#!/usr/bin/env bash
# aman-agent v0.13.0 — Demo Script
# Three scenes: "First Run" + "Returning User + Skills" + "Plans + Wellbeing"
#
# Used by VHS tape:
#   vhs docs/demo/demo.tape

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

# ── Typing ──
t() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.035
  done
}

ts() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.02
  done
}

p() { sleep "${1:-1}"; }

div() {
  printf "${D}─────────────────────────────────────────────────────────────${R}\n"
}

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 1: First Run — Zero to Wow                       ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 1${R}  ${B}First Run — Zero to Wow${R}\n"
div
p 1.5

printf "\n"
printf "  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.8

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.4
printf "  ${G}✓${R} Auto-detected Anthropic API key. Using ${B}Claude Sonnet 4.6${R}.\n"
p 0.3
printf "  ${G}✓${R} Ecosystem: identity, guardrails, 3 skills ${D}(1,847 tokens)${R}\n"
p 0.3
printf "  ${G}✓${R} Connected 30 MCP tools\n"
p 0.3
printf "  ${G}✓${R} Personality: ${D}morning session, high-drive energy${R}\n"
p 0.3
printf "  ${G}${B}Aman${R}${G} is ready.${R} Model: ${D}claude-sonnet-4-6${R}\n"
p 1

# First message
printf "\n${G}You > ${R}"
p 0.5
t "Hey! I'm building a REST API, help me set up auth"
printf "\n"
p 0.8

# Auto-triggered skills
printf "\n  ${D}[skill: api-design Lv.1 activated]${R}\n"
printf "  ${D}[skill: security Lv.1 activated]${R}\n"
p 0.3

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  Hey! I'm Aman, your AI companion. Let's get your auth set up."
printf "\n\n"
p 0.2
ts "  Here's a solid approach for REST API authentication:"
printf "\n\n"
p 0.15
ts "  1. **JWT with RS256** — asymmetric, rotatable keys"
printf "\n"
p 0.1
ts "  2. **Refresh token rotation** — short-lived access, long-lived refresh"
printf "\n"
p 0.1
ts "  3. **Rate limiting** on auth endpoints"
printf "\n\n"
p 0.15
ts "  Security headers you'll want:"
printf "\n"
p 0.1
printf "  ${D}"
ts "  Content-Security-Policy: default-src 'self'"
printf "\n"
ts "  Strict-Transport-Security: max-age=31536000"
printf "${R}\n\n"
p 0.15
ts "  Want me to scaffold this? What's your tech stack?"
printf "\n"
printf "${D} ──────────────────────────────────────────────────────────${R}\n"
p 0.3
printf "${D}  [1 memory stored] [knowledge: security-headers suggested]${R}\n"
p 2.5

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 2: Returning User — Skills + Image               ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 2${R}  ${B}Returning User — Skills That Level Up${R}\n"
div
p 1.5

printf "\n"
printf "  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.8

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.3
printf "  ${G}✓${R} Ecosystem: identity, guardrails, workflows, 5 skills ${D}(3,124 tokens)${R}\n"
p 0.3
printf "  ${G}✓${R} Connected 45 MCP tools, memory health 96%%\n"
p 0.3
printf "  ${G}✓${R} Personality: ${D}afternoon session, steady energy${R}\n"
p 0.3
printf "  ${G}${B}Aman${R}${G} is ready.${R}\n"
p 0.4
printf "\n  ${D}Welcome back. Last time we set up JWT auth for the API.${R}\n"
printf "  ${Y}Reminder: Write integration tests for auth (due today)${R}\n"
p 1.5

# Image attachment
printf "\n${G}You > ${R}"
p 0.4
t "Can you review this schema? ~/Desktop/schema.png"
printf "\n"
p 0.3
printf "  ${D}[attached image: schema.png (142.7KB)]${R}\n"
printf "  ${D}[skill: database Lv.3 activated]${R}\n"
p 0.6

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  Looking at your schema — a few observations:"
printf "\n\n"
p 0.15
ts "  - The \`users\` table looks solid. Add a \`deleted_at\` for soft deletes."
printf "\n"
p 0.1
ts "  - Missing index on \`refresh_tokens.user_id\` — this will be a"
printf "\n"
ts "    hot query path."
printf "\n"
p 0.1
ts "  - Consider a composite index on \`(user_id, expires_at)\`."
printf "\n"
printf "${D} ──────────────────────────────── memories: ~52 tokens${R}\n"
p 0.3
printf "${D}  [1 memory stored]${R}\n"
p 2

# Plan creation
printf "\n${G}You > ${R}"
p 0.4
t "/plan create Auth API | Ship JWT auth to production | Design schema, Implement endpoints, Write tests, Deploy staging, Deploy prod"
printf "\n"
p 0.5

printf "\n  ${G}Plan created!${R}\n\n"
printf "  Plan: Auth API (active)\n"
printf "  Goal: Ship JWT auth to production\n"
printf "  Progress: [${D}░░░░░░░░░░░░░░░░░░░░${R}] 0/5 (0%%)\n\n"
printf "   1. [ ] Design schema\n"
printf "   2. [ ] Implement endpoints\n"
printf "   3. [ ] Write tests\n"
printf "   4. [ ] Deploy staging\n"
printf "   5. [ ] Deploy prod\n\n"
printf "  Next: Step 1 — Design schema\n"
p 2

# Mark step done
printf "\n${G}You > ${R}"
p 0.4
t "/plan done"
printf "\n"
p 0.3

printf "\n  ${G}Step 1 done!${R}\n\n"
printf "  Plan: Auth API (active)\n"
printf "  Goal: Ship JWT auth to production\n"
printf "  Progress: [${G}████${R}${D}░░░░░░░░░░░░░░░░${R}] 1/5 (20%%)\n\n"
printf "   1. [${G}✓${R}] Design schema\n"
printf "   2. [ ] Implement endpoints\n"
printf "   3. [ ] Write tests\n"
printf "   4. [ ] Deploy staging\n"
printf "   5. [ ] Deploy prod\n\n"
printf "  Next: Step 2 — Implement endpoints\n"
p 2.5

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 3: Late Night — Wellbeing + Sentiment             ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 3${R}  ${B}Late Night — An AI That Cares${R}\n"
div
p 1.5

printf "\n"
printf "  ${D}\$${R} "
t "aman-agent"
printf "\n"
p 0.8

printf "\n"
printf "  ${B}aman agent${R}${D} — your AI companion${R}\n"
p 0.3
printf "  ${G}✓${R} Personality: ${M}late-night session, reflective energy${R}\n"
p 0.3
printf "  ${G}✓${R} Active plan: Auth API (3/5 steps)\n"
p 0.3
printf "  ${G}${B}Aman${R}${G} is ready.${R}\n"
p 0.4
printf "\n  ${D}Welcome back. You're on step 4 of Auth API — Deploy staging.${R}\n"
p 1.5

# Frustrated user
printf "\n${G}You > ${R}"
p 0.4
t "ugh the tests keep failing, tried everything and nothing works!!"
printf "\n"
p 0.3
printf "  ${D}[skill: debugging Lv.2 activated]${R}\n"
printf "  ${D}[sentiment: frustrated]${R}\n"
p 0.5

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  That sounds frustrating. Let's step back and try a different"
printf "\n"
ts "  angle — instead of looking at the failing tests, let's check"
printf "\n"
ts "  what changed since they last passed."
printf "\n\n"
p 0.2
ts "  Can you share the error output? Sometimes the second or third"
printf "\n"
ts "  line in a stack trace tells you more than the first."
printf "\n"
printf "${D} ──────────────────────────────────────────────────────────${R}\n"
p 2

# More frustration + late night = wellbeing nudge
printf "\n${G}You > ${R}"
p 0.4
t "same error again, I've been at this for 2 hours"
printf "\n"
p 0.5

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  I know this is maddening, but here's the thing — it's 1am and"
printf "\n"
ts "  you've been debugging for two hours. Fresh eyes in the morning"
printf "\n"
ts "  genuinely solve what late-night persistence can't."
printf "\n\n"
p 0.2
ts "  Save what you know so far and pick it up tomorrow. The bug"
printf "\n"
ts "  isn't going anywhere."
printf "\n"
printf "${D} ──────────────────────────────────────────────────────────${R}\n"
p 0.3
printf "${D}  [personality: sleep-frustrated nudge]${R}\n"
p 3

# End card
clear
printf "\n\n\n"
printf "  ${B}aman-agent v0.13.0${R}\n"
printf "  ${D}The AI companion that actually remembers you.${R}\n"
printf "\n"
printf "  ${G}npx @aman_asmuei/aman-agent${R}\n"
printf "\n"
printf "  ${W}Features:${R}\n"
printf "  ${D}Persistent memory   Adaptive personality   Skill leveling${R}\n"
printf "  ${D}Image support       Plan tracking          Wellbeing nudges${R}\n"
printf "  ${D}Background tasks    Project-aware sessions  Knowledge library${R}\n"
printf "\n"
printf "  ${D}MIT Licensed  |  github.com/amanasmuei/aman-agent${R}\n"
printf "\n\n\n"
p 4
