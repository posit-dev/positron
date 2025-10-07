#!/bin/bash

# Claude Code hook script for auto-formatting Positron code
# This script runs after file edits to ensure consistent formatting

set -e

# Read JSON data from stdin
HOOK_DATA=$(cat)

# Get the file path from Claude's JSON input
FILE_PATH=$(echo "$HOOK_DATA" | jq -r '.tool_input.file_path // empty')

# Exit if no file path provided
if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Check if file is a TypeScript/JavaScript or Python file
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx|mjs|cjs|py)$ ]]; then
    exit 0
fi

# Change to project directory
echo "DEBUG: CLAUDE_PROJECT_DIR='$CLAUDE_PROJECT_DIR'"
cd "$CLAUDE_PROJECT_DIR"

# Check if file exists
if [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

echo "🔧 Auto-formatting: $FILE_PATH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if it's a Python file
if [[ "$FILE_PATH" =~ \.py$ ]]; then
    echo "🐍 Running ruff format for Python..."
    if ruff format "$FILE_PATH" 2>&1; then
        echo "✓ Ruff format completed"
    else
        echo "⚠️  Ruff format encountered issues"
    fi
else
    # Handle TypeScript/JavaScript files
    # Step 1: Run ESLint with auto-fix
    echo "📋 Running ESLint..."
    if npx eslint --fix "$FILE_PATH" 2>&1; then
        echo "✓ ESLint completed"
    else
        echo "⚠️  ESLint reported issues (may have auto-fixed some)"
    fi

    # Step 2: Run TypeScript formatter
    echo ""
    echo "📐 Running TypeScript formatter..."
    if node scripts/format.js "$FILE_PATH" 2>&1; then
        echo "✓ TypeScript formatter completed"
    else
        echo "⚠️  TypeScript formatter encountered issues"
    fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Formatting complete for: $(basename "$FILE_PATH")"
