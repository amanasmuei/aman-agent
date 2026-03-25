#!/usr/bin/env bash
# aman-agent demo recording script
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

# Print instantly
instant() {
  printf '%s' "$1"
}

# Pause
pause() {
  sleep "${1:-1}"
}

clear

# ─── Startup ───────────────────────────────────────────

echo ""
printf "${BOLD}  aman agent${RESET}${DIM} — starting your AI companion${RESET}\n"
pause 0.5
printf "${GREEN}  Loaded: identity, guardrails, workflows, tools, skills ${DIM}(2,847 tokens)${RESET}\n"
pause 0.3
printf "  Model: ${DIM}claude-sonnet-4-6${RESET}\n"
pause 0.3
printf "  Connecting to MCP servers...\n"
pause 0.6
printf "${GREEN}  45 MCP tools available${RESET}\n"
pause 0.3
printf "  Memory health: ${GREEN}94%%${RESET} ${DIM}(merged 2 duplicates, pruned 1 stale)${RESET}\n"
pause 0.3
printf "${GREEN}  ${BOLD}Aman${RESET}${GREEN} is ready.${RESET}\n"
pause 0.5

echo ""
printf "  Type a message, ${DIM}/help${RESET} for commands, or ${DIM}/quit${RESET} to exit.\n"
pause 0.3

# Session context (time + reminders)
printf "${DIM}  Good evening, Aman. It's Thursday.${RESET}\n"
pause 0.3
printf "${DIM}  [OVERDUE] Review PR #42 (was due Mar 25)${RESET}\n"
printf "${DIM}  [TODAY] Deploy auth service to staging${RESET}\n"
pause 1.5

# ─── Turn 1: Memory Recall ─────────────────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "Let's work on the auth service deployment"
echo ""
pause 0.8

# Memory recall
printf "${DIM}  [memories: ~47 tokens]${RESET}\n"
pause 0.5

printf "${CYAN}\nAman > ${RESET}"
pause 0.3
type_speed "Based on our previous decisions, I can see that:"
echo ""
pause 0.2
type_speed "- The auth service uses **JWT tokens** (decided 2 weeks ago)"
echo ""
pause 0.2
type_speed "- You prefer **PostgreSQL** for the database"
echo ""
pause 0.2
type_speed "- The rewrite is driven by **compliance requirements**"
echo ""
echo ""
pause 0.2
type_speed "I also see you have an overdue reminder to review PR #42."
echo ""
type_speed "Want me to check the PR status first, or go straight to deployment?"
echo ""
pause 2

# ─── Turn 2: Tool Use + Observation ───────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "Check the PR, then let's deploy"
echo ""
pause 0.8

printf "${DIM}  [memories: ~32 tokens]${RESET}\n"
pause 0.3

printf "${CYAN}\nAman > ${RESET}"
pause 0.3
type_speed "Let me check that PR for you."
echo ""
pause 0.3
printf "${DIM}  [using github_pr_status...]${RESET}\n"
printf "${DIM}  [using deploy_staging...]${RESET}\n"
pause 1.2
echo ""
type_speed "PR #42 has 2 approvals and all checks passing. I've merged it"
echo ""
type_speed "and kicked off the staging deployment. ETA ~3 minutes."
echo ""
pause 0.5

# Memory extraction
printf "\n${DIM}  Remember: \"Auth service deployed to staging after PR #42 merge\"? (y/N) ${RESET}"
pause 1
type_slow "y"
echo ""
printf "${DIM}  [1 memory stored]${RESET}\n"
pause 0.5

# Reminder completion
printf "${DIM}  [reminder completed: Review PR #42]${RESET}\n"
pause 2

# ─── Turn 3: Preference Learning ──────────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "I prefer to always run integration tests before staging deploys"
echo ""
pause 0.8

printf "${DIM}  [memories: ~28 tokens]${RESET}\n"
pause 0.3

printf "${CYAN}\nAman > ${RESET}"
pause 0.3
type_speed "Good practice. I'll make sure to run integration tests before"
echo ""
type_speed "any future staging deployments. Noted as a workflow preference."
echo ""
pause 0.5

# Silent extraction (preference - no confirmation needed)
printf "\n${DIM}  [1 memory stored]${RESET}\n"
pause 2

# ─── Decisions Command ─────────────────────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "/decisions"
echo ""
pause 0.5

printf "${BOLD}Decision Log:${RESET}\n"
pause 0.3
printf "1. [decision] Auth service uses JWT tokens with RS256\n"
printf "   Confidence: 95%% | Age: 14d | Tags: [auth, jwt]\n"
pause 0.2
printf "2. [decision] PostgreSQL for auth database (ACID compliance)\n"
printf "   Confidence: 92%% | Age: 14d | Tags: [database, auth]\n"
pause 0.2
printf "3. [decision] Auth service deployed to staging after PR #42\n"
printf "   Confidence: 90%% | Age: just now | Tags: [deploy, auth]\n"
pause 2.5

# ─── Export ────────────────────────────────────────────

echo ""
printf "${GREEN}You > ${RESET}"
pause 0.5
type_speed "/export"
echo ""
pause 0.5
printf "${GREEN}Exported to ~/.aman-agent/exports/session-2026-03-26-2130.md${RESET}\n"
pause 1.5

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
