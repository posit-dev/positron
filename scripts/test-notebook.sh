#!/usr/bin/env bash
set -euo pipefail

# Run all Positron Notebook core tests.
# Usage:
#   ./scripts/test-notebook.sh
#   ./scripts/test-notebook.sh --grep 'find and replace'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec "$SCRIPT_DIR/test.sh" \
	--runGlob **/positronNotebook/**/*.test.js \
	"$@"
