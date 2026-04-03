#!/usr/bin/env bash
set -e

# Run Positron Vitest tests
# Usage:
#   ./scripts/test-positron-vitest.sh           # watch mode
#   ./scripts/test-positron-vitest.sh run        # single run (CI)
#   ./scripts/test-positron-vitest.sh coverage   # with coverage

if [ "$1" = "run" ]; then
	npx vitest run
elif [ "$1" = "coverage" ]; then
	npx vitest run --coverage
else
	npx vitest
fi
