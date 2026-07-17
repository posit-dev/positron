#!/usr/bin/env bash
#
# Tests for generate-package-locks-hash.sh -- the npm-core cache KEY generator.
#
# The recurring real failure mode this guards (#11886, #12521, and the key half of
# #15065) is: a file that MUST invalidate the core cache isn't folded into the hash,
# so the key doesn't rotate when it should and CI restores a stale/incomplete cache.
# cache-paths.sh is the #15065 case -- adding a cached path only takes effect once
# the key rotates, and it rotates only because cache-paths.sh is hashed.
#
# This runs the REAL script from the repo root (Node 24 strips .ts natively, so
# require('./build/npm/dirs.ts') works; the ai-lib gitlink is read from the tree,
# so no submodule checkout is needed). It mutates cache-paths.sh transiently and
# restores the exact original bytes via an EXIT trap.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GEN="$SCRIPT_DIR/generate-package-locks-hash.sh"
CACHE_PATHS="$SCRIPT_DIR/cache-paths.sh"

tests_run=0
tests_failed=0
fail() { tests_failed=$((tests_failed + 1)); echo "FAIL: $1"; }
pass() { echo "ok: $1"; }

# Restore cache-paths.sh to its exact original bytes no matter how we exit.
ORIG_CACHE_PATHS="$(mktemp)"
cp "$CACHE_PATHS" "$ORIG_CACHE_PATHS"
trap 'cp "$ORIG_CACHE_PATHS" "$CACHE_PATHS"; rm -f "$ORIG_CACHE_PATHS"' EXIT

# Run the real generator from the repo root and echo just the hash. The script
# writes "hash=<sha>" to GITHUB_OUTPUT; point that at a temp file and read it back.
gen_hash() {
	local out; out="$(mktemp)"
	( cd "$REPO_ROOT" && GITHUB_OUTPUT="$out" bash "$GEN" >/dev/null 2>&1 )
	sed -n 's/^hash=//p' "$out"
	rm -f "$out"
}

# --- Test 1: editing cache-paths.sh rotates the npm-core key (#15065 mechanism) ---
tests_run=$((tests_run + 1))
H1="$(gen_hash)"
printf '\n# test-only marker line, removed by the trap\n' >> "$CACHE_PATHS"
H2="$(gen_hash)"
if [ -n "$H1" ] && [ -n "$H2" ] && [ "$H1" != "$H2" ]; then
	pass "editing cache-paths.sh changes the hash (key rotates)"
else
	fail "cache-paths.sh edit did NOT rotate the key (H1=$H1 H2=$H2)"
fi

# --- Test 2: restoring cache-paths.sh returns the original hash (deterministic) ---
# Proves the rotation in Test 1 was caused by the edit (not nondeterminism) and that
# the same inputs always yield the same key -- a flaky key would thrash the cache.
tests_run=$((tests_run + 1))
cp "$ORIG_CACHE_PATHS" "$CACHE_PATHS"
H3="$(gen_hash)"
if [ -n "$H3" ] && [ "$H3" = "$H1" ]; then
	pass "restoring cache-paths.sh restores the original hash (deterministic)"
else
	fail "hash not deterministic across identical inputs (H1=$H1 H3=$H3)"
fi

echo
echo "Ran $tests_run tests, $tests_failed failed."
[ "$tests_failed" -eq 0 ]
