#!/usr/bin/env bash
# aman-setup: non-interactive Minimal install.
# Installs aman-agent + amem-core globally via npm. Requires Node 18+.
#
# Advanced tiers (Productive, Complete) require more choices — see
# the README for the relevant package lists.

set -euo pipefail

echo "=== aman Minimal install ==="
echo "Installs: aman-agent + amem-core"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node not found. Install Node 18+ first: https://nodejs.org" >&2
    exit 1
fi

NODE_VERSION_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_VERSION_MAJOR" -lt 18 ]; then
    echo "ERROR: Node 18+ required (you have $(node --version))" >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found. Reinstall Node from https://nodejs.org" >&2
    exit 1
fi

echo "Installing @aman_asmuei/aman-agent + @aman_asmuei/amem-core..."
npm install -g @aman_asmuei/aman-agent @aman_asmuei/amem-core

echo ""
echo "=== Done ==="
echo "Run: aman-agent"
echo "See the README's 'Install tiers' section for Productive / Complete upgrades."
