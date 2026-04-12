#!/usr/bin/env bash
set -euo pipefail

# aman-agent installer
# Usage: curl -fsSL https://raw.githubusercontent.com/amanasmuei/aman-agent/main/install.sh | bash

AMAN_HOME="${AMAN_HOME:-$HOME/.aman-agent}"
NODE_VERSION="22.16.0"

# --- Platform detection ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="darwin" ;;
  *) echo "Error: Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)   NODE_ARCH="x64" ;;
  aarch64|arm64)   NODE_ARCH="arm64" ;;
  armv7l|armv7)    NODE_ARCH="armv7l" ;;
  *) echo "Error: Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

NODE_DIST="node-v${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz"

echo "Installing aman-agent..."
echo "  Platform: ${PLATFORM}/${NODE_ARCH}"
echo "  Home:     ${AMAN_HOME}"
echo ""

# --- Create home directory ---
mkdir -p "$AMAN_HOME"

# --- Download and extract Node.js ---
if [ -x "$AMAN_HOME/node/bin/node" ]; then
  INSTALLED_NODE=$("$AMAN_HOME/node/bin/node" --version 2>/dev/null || echo "")
  if [ "$INSTALLED_NODE" = "v${NODE_VERSION}" ]; then
    echo "✓ Node.js v${NODE_VERSION} already installed"
  else
    echo "Updating Node.js ${INSTALLED_NODE} → v${NODE_VERSION}..."
    rm -rf "$AMAN_HOME/node"
  fi
fi

if [ ! -x "$AMAN_HOME/node/bin/node" ]; then
  echo "Downloading Node.js v${NODE_VERSION}..."
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$NODE_URL" -o "$TMP_DIR/node.tar.xz"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMP_DIR/node.tar.xz" "$NODE_URL"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi

  echo "Extracting..."
  mkdir -p "$AMAN_HOME/node"
  tar -xf "$TMP_DIR/node.tar.xz" -C "$AMAN_HOME/node" --strip-components=1
  rm -rf "$TMP_DIR"
  trap - EXIT

  echo "✓ Node.js v${NODE_VERSION} installed"
fi

# --- Install aman-agent via vendored npm ---
echo "Installing aman-agent..."
export PATH="$AMAN_HOME/node/bin:$PATH"
npm install -g @aman_asmuei/aman-agent@latest --prefix "$AMAN_HOME" 2>&1 | tail -1

echo "✓ aman-agent installed"

# --- Add to PATH ---
PATH_LINE="export PATH=\"\$HOME/.aman-agent/bin:\$HOME/.aman-agent/node/bin:\$PATH\""

add_to_shell_config() {
  local file="$1"
  if [ -f "$file" ]; then
    if ! grep -q ".aman-agent/bin" "$file" 2>/dev/null; then
      echo "" >> "$file"
      echo "# aman-agent" >> "$file"
      echo "$PATH_LINE" >> "$file"
      echo "  Added to $(basename "$file")"
    fi
  fi
}

echo ""
echo "Configuring PATH..."

ADDED=false
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  if [ -f "$rc" ]; then
    add_to_shell_config "$rc"
    ADDED=true
  fi
done

# If no shell config exists, create .profile
if [ "$ADDED" = false ]; then
  add_to_shell_config "$HOME/.profile"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ aman-agent installed successfully!"
echo ""
echo "  Start a new shell or run:"
echo "    source ~/.bashrc  # or ~/.zshrc"
echo ""
echo "  Then:"
echo "    aman-agent"
echo ""
echo "  Commands:"
echo "    aman-agent          Start chatting"
echo "    aman-agent setup    Full configuration wizard"
echo "    aman-agent update   Update to latest version"
echo "    aman-agent serve    Run as MCP server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
