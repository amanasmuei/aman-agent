#!/usr/bin/env bash
# Flag-contract smoke test for external LLM CLIs.
#
# aman-agent spawns `copilot` and `claude` binaries to talk to GitHub Copilot
# and Claude Code respectively. When those CLIs rename a flag (e.g. the real
# `copilot --print` → `--prompt` change in April 2026), aman-agent silently
# breaks at runtime — unit tests that mock the LLM don't catch it.
#
# This smoke greps each CLI's --help for the flags aman-agent passes.
# No API calls, no costs, <5 second runtime. Meant for nightly CI.
#
# Missing CLI → SKIP (not FAIL). Flag missing → FAIL loudly.

set -euo pipefail

PASS=0; FAIL=0; SKIP=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; [ -n "${2:-}" ] && echo "        $2"; }
skip() { SKIP=$((SKIP + 1)); echo "  SKIP: $1"; }

check_flag() {
    local label="$1"
    local cli="$2"
    local flag="$3"

    if ! command -v "$cli" >/dev/null 2>&1; then
        skip "$label: $cli not installed"
        return 0
    fi

    # Many CLIs emit help to stderr, not stdout. Capture both.
    local help
    help=$("$cli" --help 2>&1 || true)

    # Match flag as a whole-word-ish boundary to avoid substrings.
    if echo "$help" | grep -qE "(^|[^a-z-])${flag}([^a-z-]|\$)"; then
        pass "$label: $cli has $flag"
    else
        fail "$label: $cli is MISSING $flag" "SDK drift — check $cli changelog"
    fi
}

echo "=== LLM Provider Flag-Contract Smoke ==="
echo ""

# --- GitHub Copilot CLI ---
check_flag "copilot:prompt" copilot "--prompt"
check_flag "copilot:version" copilot "--version"

# --- Claude Code CLI ---
check_flag "claude:print" claude "--print"
check_flag "claude:model" claude "--model"
check_flag "claude:output-format" claude "--output-format"

echo ""
echo "---"
echo "PASS: $PASS  FAIL: $FAIL  SKIP: $SKIP"
[ "$FAIL" -eq 0 ]
