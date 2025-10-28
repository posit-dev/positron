#!/bin/bash
# Search for code patterns in Positron Notebooks
# Usage: ./find_notebook_code.sh <search-term>

if [ -z "$1" ]; then
    echo "Usage: $0 <search-term>"
    echo ""
    echo "Examples:"
    echo "  $0 'executeCell'           # Find all executeCell references"
    echo "  $0 'selectionMachine'      # Find selection machine usage"
    echo "  $0 'ContextKeysManager'    # Find context key management"
    exit 1
fi

cd "$(git rev-parse --show-toplevel)"

echo "🔍 Searching for '$1' in Positron Notebooks..."
echo ""

# Search in main notebook contribution
echo "📁 Core notebook code:"
rg "$1" src/vs/workbench/contrib/positronNotebook/ \
    --type ts --type tsx \
    -n --heading --color always \
    2>/dev/null || echo "  No matches"

echo ""

# Search in notebook service
echo "📁 Notebook service:"
rg "$1" src/vs/workbench/services/positronNotebook/ \
    --type ts \
    -n --heading --color always \
    2>/dev/null || echo "  No matches"

echo ""

# Search in tests
echo "📁 Tests:"
rg "$1" test/e2e/tests/notebook/ \
    --type ts \
    -n --heading --color always \
    2>/dev/null || echo "  No matches"
