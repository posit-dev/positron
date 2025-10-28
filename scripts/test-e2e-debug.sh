#!/bin/bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#--------------------------------------------------------------------------------------------

# Helper script to run Playwright E2E tests with debugging enabled
# This launches Electron with debugging ports open so you can attach VS Code debugger

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== E2E Test Debugging Helper ===${NC}"
echo ""

# Check if test file/pattern was provided
if [ $# -eq 0 ]; then
	echo -e "${RED}Error: No test file or pattern provided${NC}"
	echo ""
	echo "Usage: ./scripts/test-e2e-debug.sh <test-file-or-pattern> [additional-playwright-args]"
	echo ""
	echo "Examples:"
	echo "  ./scripts/test-e2e-debug.sh notebook.test.ts"
	echo "  ./scripts/test-e2e-debug.sh notebook.test.ts --grep 'cell execution'"
	echo "  ./scripts/test-e2e-debug.sh test/e2e/tests/notebook/"
	exit 1
fi

# Set environment variable to enable debugging
export POSITRON_E2E_DEBUG=1

echo -e "${YELLOW}Debug mode enabled:${NC}"
echo "  - Main process (Node): port 5875"
echo "  - Renderer process (Chrome): port 9222"
echo ""
echo -e "${YELLOW}Instructions:${NC}"
echo "  1. Set breakpoints in Positron source code (NOT test code)"
echo "  2. Run the 'Debug E2E Test' compound launch configuration in VS Code"
echo "  3. Or attach individually:"
echo "     - 'Attach to E2E Test (Electron Main Process)' for main process debugging"
echo "     - 'Attach to E2E Test (Renderer Process)' for renderer/UI debugging"
echo ""
echo -e "${GREEN}Starting test...${NC}"
echo ""

# Run the test with debugging enabled
# Pass all arguments to npx playwright test
npx playwright test "$@" --project e2e-electron
