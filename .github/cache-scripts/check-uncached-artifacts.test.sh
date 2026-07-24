#!/usr/bin/env bash
#
# Tests for check-uncached-artifacts.sh -- the guard that fails the build when
# npm install produces artifacts (files OR node_modules dirs) that aren't covered
# by cache-paths.sh and would therefore vanish on a cache hit (see #15065).
#
# The check has two external inputs, both injected here via test seams so the
# scenarios are deterministic and need neither node/dirs.ts nor the real tree:
#   CACHE_PATHS_SCRIPT  -> a fixture that sets the four *_PATHS variables
#   NM_DIRS_OVERRIDE    -> the node_modules dir list (instead of scanning disk)
# The NM_ALLOWLIST and IGNORE_PATTERNS under test are the real ones in the script.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$SCRIPT_DIR/check-uncached-artifacts.sh"

tests_run=0
tests_failed=0
fail() { tests_failed=$((tests_failed + 1)); echo "FAIL: $1"; }
pass() { echo "ok: $1"; }

# A fixture cache-paths that stands in for the real single source of truth.
# Deliberately DOES NOT list ai-lib/node_modules, so the regression test can
# assert that an uncached submodule node_modules is flagged (the #15065 bug).
FIXTURE_CACHE_PATHS="$(mktemp)"
cat > "$FIXTURE_CACHE_PATHS" <<'EOF'
NPM_CORE_PATHS=$'.npm-cache\nnode_modules\nai-lib/packages/ai-config/dist'
NPM_EXTENSIONS_VOLATILE_PATHS=$'extensions/positron-python\nextensions/positron-r'
NPM_EXTENSIONS_STABLE_PATHS=$'extensions/positron-duckdb\nextensions/node_modules'
BUILTINS_PATHS='.build/builtInExtensions'
EOF

EMPTY_SNAPSHOT="$(mktemp)"   # a "before"/"after" with no added files
printf 'README.md\n' > "$EMPTY_SNAPSHOT"
trap 'rm -f "$FIXTURE_CACHE_PATHS" "$EMPTY_SNAPSHOT"' EXIT

# Build a sorted "after" snapshot (before is always EMPTY_SNAPSHOT + README).
make_after() {
	{ printf 'README.md\n'; printf '%s\n' "$@"; } | sort
}

# Run the check with injected inputs. Args are the "added file" paths (non-nm);
# NM env var holds the node_modules dir list. Echoes combined output; writes exit
# code to RC via a temp file (command substitution runs in a subshell).
RC_FILE="$(mktemp)"; trap 'rm -f "$FIXTURE_CACHE_PATHS" "$EMPTY_SNAPSHOT" "$RC_FILE"' EXIT
run_check() {
	local nm="$1"; shift
	local after; after="$(mktemp)"
	make_after "$@" > "$after"
	CACHE_PATHS_SCRIPT="$FIXTURE_CACHE_PATHS" NM_DIRS_OVERRIDE="$nm" \
		bash "$CHECK" "$EMPTY_SNAPSHOT" "$after" 2>&1
	echo $? > "$RC_FILE"
	rm -f "$after"
}
read_rc() { RC="$(cat "$RC_FILE")"; }

# --- Test 1: fully covered -> exit 0 ---
tests_run=$((tests_run + 1))
out="$(run_check $'node_modules\nextensions/positron-duckdb/node_modules')"; read_rc
if [ "$RC" -eq 0 ] && grep -q "No uncached artifacts" <<<"$out"; then
	pass "all covered (root nm + stable-ext nm) exits 0"
else
	fail "covered case: rc=$RC"; echo "$out"
fi

# --- Test 2 (REGRESSION #15065): uncached submodule nm is flagged ---
# The bare "node_modules" cache entry must NOT substring-match "ai-lib/node_modules".
tests_run=$((tests_run + 1))
out="$(run_check "ai-lib/node_modules")"; read_rc
if [ "$RC" -eq 1 ] && grep -q "ai-lib/node_modules" <<<"$out" \
	&& grep -q "node_modules dir(s) that no cache covers" <<<"$out"; then
	pass "uncached ai-lib/node_modules is flagged (regression guard)"
else
	fail "regression: uncached ai-lib/node_modules NOT flagged (rc=$RC)"; echo "$out"
fi

# --- Test 3: allowlisted build-tool nm is accepted ---
tests_run=$((tests_run + 1))
out="$(run_check "build/rspack/node_modules")"; read_rc
if [ "$RC" -eq 0 ]; then
	pass "allowlisted build/rspack/node_modules accepted"
else
	fail "allowlist: build/rspack flagged unexpectedly (rc=$RC)"; echo "$out"
fi

# --- Test 4: nested node_modules under a covered root is fine ---
tests_run=$((tests_run + 1))
out="$(run_check "node_modules/foo/node_modules")"; read_rc
if [ "$RC" -eq 0 ]; then
	pass "nested nm under covered root is covered"
else
	fail "nested: flagged unexpectedly (rc=$RC)"; echo "$out"
fi

# --- Test 5: uncached non-nm file is flagged ---
tests_run=$((tests_run + 1))
out="$(run_check "" "src/generated/thing.js")"; read_rc
if [ "$RC" -eq 1 ] && grep -q "files outside node_modules" <<<"$out"; then
	pass "uncached non-nm file flagged"
else
	fail "file: uncached file not flagged (rc=$RC)"; echo "$out"
fi

# --- Test 6: ignored patterns (.pyc) and cached dist file don't flag ---
tests_run=$((tests_run + 1))
out="$(run_check "" "extensions/foo/__pycache__/x.pyc" "ai-lib/packages/ai-config/dist/node/mutate-config.js")"; read_rc
if [ "$RC" -eq 0 ] && grep -q "No uncached artifacts" <<<"$out"; then
	pass "pycache ignored + cached dist covered"
else
	fail "ignore: pyc/dist wrongly flagged (rc=$RC)"; echo "$out"
fi

# --- Test 7: both a bad file and a bad nm dir -> exit 1, both reported ---
tests_run=$((tests_run + 1))
out="$(run_check "some-lib/node_modules" "src/generated/thing.js")"; read_rc
if [ "$RC" -eq 1 ] \
	&& grep -q "some-lib/node_modules" <<<"$out" \
	&& grep -q "src/generated/thing.js" <<<"$out"; then
	pass "combined file + nm failures both reported, exit 1"
else
	fail "combined: missing one of the failures (rc=$RC)"; echo "$out"
fi

# --- Test 8: empty nm list + no added files -> exit 0 ---
tests_run=$((tests_run + 1))
out="$(run_check "")"; read_rc
if [ "$RC" -eq 0 ]; then
	pass "empty inputs exit 0"
else
	fail "empty: rc=$RC"; echo "$out"
fi

# --- Test 9: multiple uncovered nm dirs are all listed ---
tests_run=$((tests_run + 1))
out="$(run_check $'a-lib/node_modules\nb-lib/node_modules')"; read_rc
if [ "$RC" -eq 1 ] \
	&& grep -q "a-lib/node_modules" <<<"$out" \
	&& grep -q "b-lib/node_modules" <<<"$out" \
	&& grep -q "2 node_modules dir(s)" <<<"$out"; then
	pass "multiple uncovered nm dirs all reported"
else
	fail "multiple: not all reported (rc=$RC)"; echo "$out"
fi

# --- Test 10 (REGRESSION #13545): incident-backed IGNORE_PATTERNS stay ignored ---
# .git/ was a real shipped false positive (#13545): git objects created during CI
# were flagged as uncached artifacts and failed the build. .claude/ (agent-harness
# symlinks) and .tsbuildinfo (incremental tsc caches) are the same shape -- files
# npm install may touch that tests never need. A "cleanup" that drops any of these
# from IGNORE_PATTERNS would reintroduce a build failure, so guard them here.
tests_run=$((tests_run + 1))
out="$(run_check "" \
	".git/objects/ab/cdef0123456789" \
	".claude/CLAUDE.md" \
	"ai-lib/packages/ai-config/tsconfig.tsbuildinfo")"; read_rc
if [ "$RC" -eq 0 ] && grep -q "No uncached artifacts" <<<"$out"; then
	pass "incident-backed ignores (.git/, .claude/, .tsbuildinfo) stay ignored"
else
	fail "ignore-regression: a protected pattern was flagged (rc=$RC)"; echo "$out"
fi

echo
echo "Ran $tests_run tests, $tests_failed failed."
[ "$tests_failed" -eq 0 ]
