#!/bin/bash
# Run Positron Notebook E2E tests
# Usage: ./test_notebooks.sh [test-name-pattern]

set -e

# Check build daemons first
if ! pgrep -f "watch-client" > /dev/null || ! pgrep -f "watch-extensions" > /dev/null; then
    echo "⚠️  Warning: Build daemons may not be running"
    echo "   Check with: ps aux | grep -E 'npm.*watch-(client|extensions)d' | grep -v grep"
    echo ""
fi

cd "$(git rev-parse --show-toplevel)"

if [ -z "$1" ]; then
    echo "🧪 Running all notebook E2E tests..."
    npx playwright test test/e2e/tests/notebook/ --project e2e-electron --reporter list
else
    echo "🧪 Running notebook tests matching: $1"
    npx playwright test test/e2e/tests/notebook/ --project e2e-electron --reporter list --grep "$1"
fi

echo ""
echo "📊 To view detailed report: npx playwright show-report"
