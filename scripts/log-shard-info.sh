#!/bin/bash
# Log sharding information for CI visibility

set -e

PROJECT="${1:-e2e-electron}"
SHARD_CURRENT="${2:-1}"
SHARD_TOTAL="${3:-1}"
GREP_PATTERN="${4:-}"

echo "=================================================="
echo "Playwright Sharding Information"
echo "=================================================="
echo "Project: $PROJECT"
echo "Shard: $SHARD_CURRENT/$SHARD_TOTAL"
if [ -n "$GREP_PATTERN" ]; then
  echo "Filter: $GREP_PATTERN"
fi
echo ""

# Check for .last-run.json
LAST_RUN_FILE="blob-report/.last-run.json"
if [ -f "$LAST_RUN_FILE" ]; then
  FILE_SIZE=$(ls -lh "$LAST_RUN_FILE" | awk '{print $5}')
  echo "✓ Last run data found: $LAST_RUN_FILE ($FILE_SIZE)"

  # Count tests with duration data
  if command -v jq &> /dev/null; then
    TEST_COUNT=$(jq '.testDurations | length' "$LAST_RUN_FILE" 2>/dev/null || echo "0")
    TOTAL_DURATION=$(jq '[.testDurations[]] | add' "$LAST_RUN_FILE" 2>/dev/null || echo "0")
    TOTAL_DURATION_SEC=$(echo "scale=1; $TOTAL_DURATION / 1000" | bc 2>/dev/null || echo "0")
    echo "  • Tests with duration data: $TEST_COUNT"
    echo "  • Total duration from last run: ${TOTAL_DURATION_SEC}s"
    SHARDING_MODE="duration-round-robin"
  else
    echo "  • jq not available, cannot parse duration data"
    SHARDING_MODE="duration-round-robin (fallback to round-robin)"
  fi
else
  echo "⚠ No last run data found at $LAST_RUN_FILE"
  echo "  • First run or data not available"
  echo "  • Will use round-robin distribution"
  SHARDING_MODE="round-robin (no duration data)"
fi

echo ""
echo "Sharding mode: $SHARDING_MODE"
echo ""

# Count tests in this shard
if [ -n "$GREP_PATTERN" ]; then
  GREP_ARG="--grep \"$GREP_PATTERN\""
else
  GREP_ARG=""
fi

if [ "$SHARD_TOTAL" -gt "1" ]; then
  echo "--- Tests assigned to shard $SHARD_CURRENT/$SHARD_TOTAL ---"
  TEST_LIST=$(eval "npx playwright test --project $PROJECT --shard $SHARD_CURRENT/$SHARD_TOTAL $GREP_ARG --list 2>&1" || true)
  TEST_COUNT_IN_SHARD=$(echo "$TEST_LIST" | grep -c "test\.ts" || echo "0")
  echo "  • Test count: $TEST_COUNT_IN_SHARD"

  # Estimate duration for this shard if we have .last-run.json
  if [ -f "$LAST_RUN_FILE" ] && command -v jq &> /dev/null; then
    # Get test IDs from list output and calculate estimated duration
    # This is approximate since we'd need to parse test IDs from the list
    AVG_DURATION=$(jq '[.testDurations[]] | add / length' "$LAST_RUN_FILE" 2>/dev/null || echo "0")
    AVG_DURATION_SEC=$(echo "scale=1; $AVG_DURATION / 1000" | bc 2>/dev/null || echo "0")
    ESTIMATED_SHARD_DURATION=$(echo "scale=1; $AVG_DURATION_SEC * $TEST_COUNT_IN_SHARD" | bc 2>/dev/null || echo "0")
    echo "  • Estimated duration: ~${ESTIMATED_SHARD_DURATION}s (avg: ${AVG_DURATION_SEC}s/test)"
  fi
else
  echo "--- Running all tests (no sharding) ---"
  TEST_LIST=$(eval "npx playwright test --project $PROJECT $GREP_ARG --list 2>&1" || true)
  TEST_COUNT_IN_SHARD=$(echo "$TEST_LIST" | grep -c "test\.ts" || echo "0")
  echo "  • Test count: $TEST_COUNT_IN_SHARD"
fi

echo ""
echo "=================================================="
