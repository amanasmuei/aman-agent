#!/usr/bin/env bash
# aman-agent v0.6.0 — Professional Demo Script
# Two scenes: "First Run Magic" + "Returning User Power"
#
# Used by VHS tape or standalone:
#   vhs docs/demo/demo.tape
#   OR: bash docs/demo/demo-script.sh

set -e

# ── Colors ──
C='\033[0;36m'    # cyan
G='\033[0;32m'    # green
Y='\033[0;33m'    # yellow
D='\033[2m'       # dim
B='\033[1m'       # bold
R='\033[0m'       # reset
W='\033[37m'      # white

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

# ── Divider ──
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

# Init wizard
printf "\n"
printf "  ${D}\$${R} "
t "aman-agent init"
printf "\n"
p 0.6

printf "\n"
printf "  ${B}aman agent init${R}${D} — set up your companion${R}\n"
p 0.5

printf "\n"
printf "  ${W}What should your companion be called?${R}\n"
printf "  ${D}(Aman)${R} "
p 0.8
t "Aman"
printf "\n"
p 0.5

printf "\n"
printf "  ${W}What kind of companion do you need?${R}\n"
printf "  ${G}>${R} ${B}Coding Partner${R}    ${D}direct, technical, concise${R}\n"
printf "    Creative Collaborator  ${D}warm, imaginative${R}\n"
printf "    Personal Assistant     ${D}organized, action-oriented${R}\n"
printf "    Learning Buddy         ${D}patient, Socratic${R}\n"
printf "    Minimal                ${D}just chat${R}\n"
p 1.2

printf "\n"
printf "  ${G}✓${R} Identity created — direct, technical, concise\n"
p 0.3
printf "  ${G}✓${R} 3 rules set\n"
p 0.3
printf "  ${G}✓${R} 1 workflow added\n"
p 0.4
printf "\n"
printf "  Your companion is ready. Run: ${B}aman-agent${R}\n"
p 2

clear

# First chat session
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
printf "  ${G}✓${R} Ecosystem ready: identity, guardrails ${D}(1,204 tokens)${R}\n"
p 0.3
printf "  ${G}✓${R} Connected 30 MCP tools\n"
p 0.3
printf "  ${G}${B}Aman${R}${G} is ready.${R} Model: ${D}claude-sonnet-4-6${R}\n"
p 0.6

printf "\n"
printf "  Type a message, ${D}/help${R} for commands, or ${D}/quit${R} to exit.\n"
p 1

# First message
printf "\n"
printf "${G}You > ${R}"
p 0.5
t "Hey, what can you do?"
printf "\n"
p 0.8

# First-run greeting (agent introduces itself)
printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  Hey! I'm Aman, your personal AI companion. Unlike regular"
printf "\n"
ts "  chatbots, I'll remember our conversations and grow with you"
printf "\n"
ts "  over time — your preferences, decisions, and patterns all"
printf "\n"
ts "  persist across sessions."
printf "\n\n"
p 0.2
ts "  What should I call you?"
printf "\n"
printf "${D} ──────────────────────────────────────────────────────────${R}\n"
p 0.3
printf "${D}  [1 memory stored]${R}\n"
p 2.5

clear

# ╔═══════════════════════════════════════════════════════════╗
# ║  SCENE 2: Returning User — The Companion That Grows     ║
# ╚═══════════════════════════════════════════════════════════╝

printf "\n"
printf "  ${D}SCENE 2${R}  ${B}Returning User — The Companion That Grows${R}\n"
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
printf "  ${G}✓${R} Ecosystem ready: identity, guardrails, workflows ${D}(2,847 tokens)${R}\n"
p 0.3
printf "  ${G}✓${R} Connected 45 MCP tools, memory health 94%%\n"
p 0.3
printf "  ${G}${B}Aman${R}${G} is ready.${R} Model: ${D}claude-sonnet-4-6${R}\n"
p 0.5

printf "\n"
printf "  Type a message, ${D}/help${R} for commands, or ${D}/quit${R} to exit.\n"
p 0.3

# Returning greeting + reminders
printf "\n"
printf "  ${D}Welcome back. Last time we talked about the auth service.${R}\n"
printf "  ${Y}Reminder: Review PR #42 (overdue)${R}\n"
printf "  ${Y}Reminder: Deploy auth service to staging (due today)${R}\n"
p 1.5

# Turn 1: Memory recall
printf "\n${G}You > ${R}"
p 0.4
t "Let's deploy the auth service"
printf "\n"
p 0.7

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  Based on our previous sessions:"
printf "\n\n"
p 0.15
ts "  - Auth service uses **JWT tokens with RS256**"
printf "\n"
p 0.15
ts "  - Database: **PostgreSQL** (your preference)"
printf "\n"
p 0.15
ts "  - Driven by **compliance requirements**"
printf "\n\n"
p 0.15
ts "  I see PR #42 is overdue. Let me check and deploy."
printf "\n"
p 0.3
printf "\n  ${D}[using github_pr_status...]${R}\n"
printf "  ${D}[using deploy_staging...]${R}\n"
p 1
printf "\n"
ts "  PR merged, staging deploy started. ETA ~3 minutes."
printf "\n"
printf "${D} ──────────────────────────────────── memories: ~47 tokens${R}\n"
p 0.3
printf "${D}  [1 memory stored]${R}\n"
printf "${D}  [reminder completed: Review PR #42]${R}\n"
p 2

# Turn 2: Preference + hint
printf "\n${G}You > ${R}"
p 0.4
t "Always run integration tests before staging deploys"
printf "\n"
p 0.7

printf "\n ${C}${B}Aman${R} ${D}──────────────────────────────────────────────${R}\n"
printf "\n"
p 0.3
ts "  Got it. I'll run integration tests before any future staging"
printf "\n"
ts "  deployments. Noted as a workflow preference."
printf "\n"
printf "${D} ──────────────────────────────────── memories: ~28 tokens${R}\n"
p 0.3
printf "${D}  [1 memory stored]${R}\n"
p 0.3
printf "${D}  Tip: Teach me multi-step processes with /workflows add${R}\n"
p 2

# Memory timeline
printf "\n${G}You > ${R}"
p 0.4
t "/memory timeline"
printf "\n"
p 0.5

printf "\n  ${B}Memory Timeline:${R}\n\n"
printf "  Mar 24  ${G}██░░░░░░░░${R}  12 memories\n"
printf "  Mar 25  ${G}█████░░░░░${R}  47 memories\n"
printf "  Mar 26  ${G}████████░░${R}  89 memories\n"
printf "\n"
printf "  Total: 148 memories\n"
printf "  Top tags: #auth (34), #preferences (28), #deploy (22)\n"
p 3

# End card
clear
printf "\n\n\n\n"
printf "  ${B}aman-agent${R}\n"
printf "  ${D}The AI companion that actually remembers you.${R}\n"
printf "\n"
printf "  ${G}npx @aman_asmuei/aman-agent${R}\n"
printf "\n"
printf "  ${D}MIT Licensed  |  github.com/amanasmuei/aman-agent${R}\n"
printf "\n\n\n"
p 4
