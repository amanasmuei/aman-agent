#!/usr/bin/env bash
# aman-agent v0.6.0 demo recording script
# Usage: ./demo-script.sh
#
# This script simulates an aman-agent session for recording.
# It types out commands and responses with realistic timing.
#
# To record:
#   asciinema rec demo.cast -c "./demo-script.sh" --cols 90 --rows 30
#
# To convert to gif:
#   agg demo.cast demo.gif --theme monokai --font-size 16 --speed 1.5

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
BOLD='\033[1m'
RED='\033[0;31m'
RESET='\033[0m'

# Typing speed
type_speed() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.04
  done
}

type_slow() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.07
  done
}

# Pause
pause() {
  sleep "${1:-1}"
}

clear

# ─── Startup (v0.6.0: animated spinner sequence) ─────

echo ""
printf "${BOLD}  aman agent${RESET}${DIM} — your AI companion${RESET}\n"
pause 0.4
printf "${GREEN}  Auto-detected Anthropic API key. Using Claude Sonnet 4.6.${RESET}\n"
pause 0.5
printf "${GREEN}  ✓${RESET} Ecosystem ready: identity, guardrails, workflows ${DIM}(2,847 tokens)${RESET}\n"
pause 0.4
printf "${GREEN}  ✓${RESET} Connected 45 MCP tools, memory health 94%%\n"
pause 0.4
printf "${GREEN}  ${BOLD}Aman${RESET}${GREEN} is ready. Model: ${DIM}claude-sonnet-4-6${RESET}\n"
pause 0.5

echo ""
printf "  Type a message, ${DIM}/help${RESET} for commands, or ${DIM}/quit${RESET} to exit.\n"
pause 0.3

# v0.6.0: Returning user greeting with resume topic
printf "${DIM}  Welcome back. Last time we talked about the auth service.${RESET}\n"
pause 0.3
# v0.6.0: Visible reminders (not buried in context)
printf "${YELLOW}  Reminder: Review PR #42 (overdue)${RESET}\n"
printf "${YELLOW}  Reminder: Deploy auth service to staging (due today)${RESET}\n"
pause 1.5

# ─── Turn 1: Memory Recall + Rich Output ─────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "Let's work on the auth service deployment"
echo ""
pause 0.8

# v0.6.0: Response framing with dividers
printf "\n ${CYAN}${BOLD}Aman${RESET} ${DIM}──────────────────────────────────────────────${RESET}\n"
echo ""
pause 0.3
type_speed "  Based on our previous decisions, I can see that:"
echo ""
pause 0.2
echo ""
type_speed "  - The auth service uses **JWT tokens** (decided 2 weeks ago)"
echo ""
pause 0.2
type_speed "  - You prefer **PostgreSQL** for the database"
echo ""
pause 0.2
type_speed "  - The rewrite is driven by **compliance requirements**"
echo ""
echo ""
pause 0.2
type_speed "  I also see you have an overdue reminder to review PR #42."
echo ""
type_speed "  Want me to check the PR status first, or go straight to deployment?"
echo ""
# v0.6.0: Footer with memory token count
printf "${DIM} ────────────────────────────────────── memories: ~47 tokens${RESET}\n"
pause 2

# ─── Turn 2: Tool Use + Silent Memory ────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "Check the PR, then let's deploy"
echo ""
pause 0.8

printf "\n ${CYAN}${BOLD}Aman${RESET} ${DIM}──────────────────────────────────────────────${RESET}\n"
echo ""
pause 0.3
type_speed "  Let me check that PR for you."
echo ""
pause 0.3
printf "${DIM}  [using github_pr_status...]${RESET}\n"
printf "${DIM}  [using deploy_staging...]${RESET}\n"
pause 1.2
echo ""
type_speed "  PR #42 has 2 approvals and all checks passing. I've merged it"
echo ""
type_speed "  and kicked off the staging deployment. ETA ~3 minutes."
echo ""
printf "${DIM} ────────────────────────────────────── memories: ~32 tokens${RESET}\n"
pause 0.5

# v0.6.0: Silent memory — no more y/N prompts!
printf "${DIM}  [1 memory stored]${RESET}\n"
printf "${DIM}  [reminder completed: Review PR #42]${RESET}\n"
pause 2

# ─── Turn 3: Preference Learning + Hint ──────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "I prefer to always run integration tests before staging deploys"
echo ""
pause 0.8

printf "\n ${CYAN}${BOLD}Aman${RESET} ${DIM}──────────────────────────────────────────────${RESET}\n"
echo ""
pause 0.3
type_speed "  Good practice. I'll make sure to run integration tests before"
echo ""
type_speed "  any future staging deployments. Noted as a workflow preference."
echo ""
printf "${DIM} ────────────────────────────────────── memories: ~28 tokens${RESET}\n"
pause 0.3

# v0.6.0: Silent extraction (all types auto-stored)
printf "${DIM}  [1 memory stored]${RESET}\n"
pause 0.5

# v0.6.0: Progressive feature hint
printf "${DIM}  Tip: Teach me multi-step processes with /workflows add${RESET}\n"
pause 2

# ─── Memory Timeline (v0.6.0 new command) ────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "/memory timeline"
echo ""
pause 0.5

printf "${BOLD}Memory Timeline:${RESET}\n"
echo ""
printf "  Mar 24  ${GREEN}██░░░░░░░░${RESET}  12 memories\n"
printf "  Mar 25  ${GREEN}█████░░░░░${RESET}  47 memories\n"
printf "  Mar 26  ${GREEN}████████░░${RESET}  89 memories\n"
echo ""
printf "  Total: 148 memories\n"
printf "  Top tags: #auth (34), #preferences (28), #deploy (22)\n"
pause 2.5

# ─── Doctor (v0.6.0 upgraded) ────────────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "/doctor"
echo ""
pause 0.5

printf "${BOLD}Aman Health Check${RESET}\n"
echo ""
printf "  ${GREEN}✓${RESET} Identity     ${GREEN}Aman — direct, technical, concise${RESET}\n"
printf "  ${GREEN}✓${RESET} Rules        ${GREEN}3 safety, 2 behavioral${RESET}\n"
printf "  ${GREEN}✓${RESET} Workflows    ${GREEN}2 workflows (debug, deploy)${RESET}\n"
printf "  ${GREEN}✓${RESET} Tools        ${GREEN}5 tools configured${RESET}\n"
printf "  ${YELLOW}⚠${RESET} Skills       ${YELLOW}empty${RESET}\n"
printf "    ${DIM}→ Add with /skills install <name>${RESET}\n"
echo ""
printf "  ${GREEN}✓${RESET} MCP          ${GREEN}45 tools${RESET}\n"
printf "  ${GREEN}✓${RESET} Memory       ${GREEN}connected${RESET}\n"
echo ""
printf "  Overall: 6/7 healthy. 1 suggestion.\n"
pause 2.5

# ─── Quit ──────────────────────────────────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "/quit"
echo ""
pause 0.5
printf "${DIM}  Saving conversation to memory...${RESET}\n"
pause 0.5
printf "${DIM}  Saved 6 messages (session: session-2026-03-26-2130)${RESET}\n"
pause 0.5
printf "${DIM}\nGoodbye.${RESET}\n"
pause 2

echo ""
printf "${BOLD}  npx @aman_asmuei/aman-agent${RESET}\n"
printf "${DIM}  MIT Licensed | github.com/amanasmuei/aman-agent${RESET}\n"
echo ""
pause 3
