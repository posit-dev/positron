#!/bin/bash
# Validate Positron Notebooks development setup
# Checks that all critical paths and dependencies are ready

set -e

echo "🔍 Validating Positron Notebooks setup..."
echo ""

ERRORS=0

# Check build daemons
echo "Checking build daemons..."
if pgrep -f "watch-client" > /dev/null; then
    echo "  ✅ watch-clientd running"
else
    echo "  ❌ watch-clientd NOT running (start with: npm run watch-clientd &)"
    ERRORS=$((ERRORS + 1))
fi

if pgrep -f "watch-extensions" > /dev/null; then
    echo "  ✅ watch-extensionsd running"
else
    echo "  ❌ watch-extensionsd NOT running (start with: npm run watch-extensionsd &)"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "Checking core notebook files..."

CORE_FILES=(
    "src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts"
    "src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts"
    "src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor.tsx"
    "src/vs/workbench/services/positronNotebook/browser/positronNotebookService.ts"
)

for file in "${CORE_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ $file NOT FOUND"
        ERRORS=$((ERRORS + 1))
    fi
done

echo ""
echo "Checking test directories..."

TEST_DIRS=(
    "test/e2e/tests/notebook"
    "src/vs/workbench/contrib/positronNotebook/test/browser"
)

for dir in "${TEST_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo "  ✅ $dir"
    else
        echo "  ❌ $dir NOT FOUND"
        ERRORS=$((ERRORS + 1))
    fi
done

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "✅ All checks passed! Ready for notebook development."
    exit 0
else
    echo "❌ $ERRORS error(s) found. Fix issues before proceeding."
    exit 1
fi
