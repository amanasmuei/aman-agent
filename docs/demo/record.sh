#!/usr/bin/env bash
# Record and convert the aman-agent demo
#
# Prerequisites:
#   brew install asciinema
#   cargo install --git https://github.com/asciinema/agg
#
# Usage:
#   cd docs/demo && ./record.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Recording demo..."
asciinema rec "$SCRIPT_DIR/demo.cast" \
  -c "$SCRIPT_DIR/demo-script.sh" \
  --cols 90 \
  --rows 30 \
  --overwrite \
  --idle-time-limit 3

echo ""
echo "Converting to GIF..."
agg "$SCRIPT_DIR/demo.cast" "$SCRIPT_DIR/demo.gif" \
  --theme monokai \
  --font-size 16 \
  --speed 1.5 \
  --last-frame-duration 5

echo ""
echo "Done!"
echo "  Cast: $SCRIPT_DIR/demo.cast"
echo "  GIF:  $SCRIPT_DIR/demo.gif"
echo ""
echo "To preview: open $SCRIPT_DIR/demo.gif"
echo "To replay:  asciinema play $SCRIPT_DIR/demo.cast"
