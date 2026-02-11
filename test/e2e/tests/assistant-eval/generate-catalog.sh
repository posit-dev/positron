#!/bin/bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Generate the EVAL_CATALOG.md and EVAL_CATALOG.html files without running tests.
#
# Usage (from repo root):
#   ./test/e2e/tests/assistant-eval/generate-catalog.sh
#
# Prerequisites:
#   - e2e tests must be compiled (run: npm run build-start)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
OUT_DIR="$REPO_ROOT/test/e2e/out/tests/assistant-eval"
SRC_DIR="$SCRIPT_DIR"

# Check if compiled script exists
if [ ! -f "$OUT_DIR/generate-catalog.js" ]; then
	echo "Error: Compiled script not found at $OUT_DIR/generate-catalog.js"
	echo "Please run 'npm run build-start' first to compile e2e tests."
	exit 1
fi

# Run the generator
echo "Running catalog generator..."
node "$OUT_DIR/generate-catalog.js"

# Copy file to source directory
echo ""
echo "Copying to source directory..."
cp "$OUT_DIR/LLM_EVAL_TEST_CATALOG.html" "$SRC_DIR/"

echo ""
echo "✅ Catalog generated:"
echo "   $SRC_DIR/LLM_EVAL_TEST_CATALOG.html"
