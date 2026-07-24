#!/usr/bin/env bash
# ============================================================================
# check-uncached-artifacts.sh - Detect Missing Cache Entries
# ============================================================================
#
# WHAT THIS DOES:
# Finds files created by npm postinstall scripts that aren't cached.
# If these files aren't cached, they'll be missing when cache hits on next run,
# causing mysterious test failures.
#
# THE PROBLEM WE'RE SOLVING:
# npm install runs postinstall scripts that can:
# • Download binaries (Ark, Kallichore, pet)
# • Generate files (Python bytecode, vendored packages)
# • Build native modules (node-gyp)
#
# If these artifacts aren't in cache-paths.sh, they vanish when caches hit!
#
# HOW IT WORKS:
# 1. Workflow captures file tree BEFORE npm install → before.txt
# 2. Workflow runs npm install (postinstall scripts run)
# 3. Workflow captures file tree AFTER npm install → after.txt
# 4. This script diffs them and checks against cache-paths.sh
# 5. Reports any files that should probably be cached
#
# node_modules IS checked -- at DIRECTORY granularity (Section 3.5). A blanket
# "ignore all node_modules" used to hide the exact bug in #15065: ai-lib/node_modules
# held a runtime dep (proper-lockfile) and wasn't in cache-paths.sh, so it vanished
# on a cache hit. Section 3.5 enumerates node_modules dirs from disk (the before/after
# snapshots strip them) and flags any that NO cache-paths.sh entry covers by path
# prefix. The file scan below still skips node_modules files for volume/perf.
#
# WHAT TO DO IF FILES ARE DETECTED:
#
# Option A - Add to cache (if tests need these files):
#   • Core/build paths: Edit .github/cache-scripts/cache-paths.sh
#   • Volatile extensions: Edit build/npm/dirs.ts (volatileExtensions array)
#   • Stable extensions: Already cached automatically!
#   • Verify: Run .github/cache-scripts/verify-cache-paths.sh
#
# Option B - Ignore (if tests don't need these files):
#   • Add pattern to IGNORE_PATTERNS below (Section 3)
#
# USAGE:
# check-uncached-artifacts.sh <before-file> <after-file>
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Input Validation
# ============================================================================

BEFORE_FILE="$1"
AFTER_FILE="$2"

if [[ ! -f "$BEFORE_FILE" ]] || [[ ! -f "$AFTER_FILE" ]]; then
	echo "❌ Error: File tree snapshots not found"
	echo "Usage: $0 <before-file> <after-file>"
	exit 1
fi

echo "🔍 Checking for uncached postinstall artifacts..."

# ============================================================================
# SECTION 2: Find Files Added by npm install
# ============================================================================
# Compare before/after snapshots to see what postinstall scripts created.
# Exclude the npm download cache (.npm-cache) -- it is always cached and huge.
# node_modules FILES are excluded here too, but only from this file-level scan
# (their volume would be enormous and slow the per-file loop). node_modules is
# instead checked at directory granularity in Section 3.5 -- NOT ignored.

ADDED_FILES=$(comm -13 "$BEFORE_FILE" "$AFTER_FILE" | grep -v "\.npm-cache" | grep -v "node_modules" || true)

# ============================================================================
# SECTION 3: Build Ignore Patterns from Cache Configuration
# ============================================================================
# Load cache paths from single source of truth and build ignore list.
# Anything already in cache-paths.sh doesn't need a warning.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Test seam: CACHE_PATHS_SCRIPT overrides where the path variables come from, so
# the coverage logic can be unit-tested against a controlled set (including one
# that omits ai-lib/node_modules, to guard the #15065 regression) without running
# node/dirs.ts. Defaults to the real single source of truth.
source "${CACHE_PATHS_SCRIPT:-$SCRIPT_DIR/cache-paths.sh}"

IGNORE_PATTERNS=()

# Add all cached paths to ignore list
# (These are already covered by cache-paths.sh, so no warning needed)

while IFS= read -r path; do
	[ -z "$path" ] && continue
	IGNORE_PATTERNS+=("$path")
done <<< "$NPM_CORE_PATHS"

while IFS= read -r path; do
	[ -z "$path" ] && continue
	IGNORE_PATTERNS+=("$path")
done <<< "$NPM_EXTENSIONS_VOLATILE_PATHS"

while IFS= read -r path; do
	[ -z "$path" ] && continue
	IGNORE_PATTERNS+=("$path")
done <<< "$NPM_EXTENSIONS_STABLE_PATHS"

while IFS= read -r path; do
	[ -z "$path" ] && continue
	IGNORE_PATTERNS+=("$path")
done <<< "$BUILTINS_PATHS"

# ----------------------------------------------------------------------------
# Additional Ignore Patterns
# ----------------------------------------------------------------------------
# Files that are safe to ignore even if not explicitly in cache-paths.sh.
# Add patterns here if you're confident tests don't need them.

IGNORE_PATTERNS+=(
	# Python bytecode (auto-generated by Python, harmless to regenerate)
	".pyc"
	"__pycache__"
	".cpython-"
	# Git internal objects created by git operations during CI (not source files)
	".git/"
	# Agent-harness symlinks recreated by build/npm/postinstall.ts on every
	# install (.claude/CLAUDE.md -> .github/copilot-instructions.md,
	# .claude/skills -> .agents/skills). Gitignored dev tooling, not needed by
	# tests/build, and regenerated idempotently, so nothing to cache.
	".claude/"
	# TypeScript incremental-build caches emitted by composite/incremental
	# projects (e.g. ai-lib/packages/ai-config, which has "composite": true).
	# Nothing imports these -- tsc reads them only to skip unchanged files on a
	# recompile, and regenerates them whenever it compiles. The actual build
	# output (dist/) is cached separately, so a missing .tsbuildinfo costs at
	# most a full recompile, never a broken build.
	".tsbuildinfo"
)

# ============================================================================
# SECTION 3.5: node_modules Directory Coverage
# ============================================================================
# The file scan (Section 2) skips node_modules for volume, but an UNCACHED
# node_modules dir is exactly how a runtime dep goes missing on a cache hit
# (#15065). Check node_modules at directory granularity: collapse each added
# node_modules path to its OUTERMOST node_modules dir, then flag any that no
# real cache-paths.sh entry covers by path PREFIX (a bare "node_modules" pattern
# must not substring-match "ai-lib/node_modules").

# Real cache directories that can cover a node_modules dir. Built only from the
# path variables (not the substring IGNORE_PATTERNS like ".pyc"), since only a
# real cached dir actually preserves a node_modules tree across a cache hit.
CACHED_DIRS=()
for var in "$NPM_CORE_PATHS" "$NPM_EXTENSIONS_VOLATILE_PATHS" "$NPM_EXTENSIONS_STABLE_PATHS" "$BUILTINS_PATHS"; do
	while IFS= read -r p; do
		[ -z "$p" ] && continue
		CACHED_DIRS+=("${p%/}")   # normalize: drop any trailing slash
	done <<< "$var"
done

# Known-uncovered install dirs we deliberately accept (do NOT fail on these).
# Each is a build-tool workspace (declared in build/npm/dirs.ts) whose deps are
# used only WHILE building -- the build step always runs -- and are never loaded
# on a cache-hit test run, so a missing copy costs at most a rebuild, not a broken
# run (contrast ai-lib/node_modules, which ships a runtime import). This turns a
# silent blanket exclusion into a reviewed allowlist.
# TODO(#15065 follow-up): confirm none are needed on cache-hit runs, then either
# cache them in cache-paths.sh or leave here with this rationale.
NM_ALLOWLIST=(
	"build/rspack/node_modules"
	"build/vite/node_modules"
	"build/npm/gyp/node_modules"
	# test/e2e is commented out in build/npm/dirs.ts, so the checked job never
	# installs it; its deps are e2e-only and never loaded on a cache-hit unit run.
	# If e2e install is ever added to a job running this check, cache it instead.
	"test/e2e/node_modules"
)

# Enumerate node_modules dirs from the FILESYSTEM, not the before/after diff:
# the workflow builds both snapshots with `grep -v "node_modules/"`, so the diff
# never contains them. npm install has just run when this check fires, so the real
# tree is on disk. Take outermost node_modules only (-not -path '*/node_modules/*'
# drops nested ones -- if the outer dir is covered so are they). Prune tool-managed
# trees that aren't npm-install output (absent in the unit job; pruned defensively
# in case this check is reused in a job that has them).
# Test seam: NM_DIRS_OVERRIDE supplies the dir list (newline-separated) instead
# of scanning the filesystem, so coverage/allowlist logic is unit-testable. Set
# but empty means "no node_modules dirs" (uses +x so that case is honored).
if [ -n "${NM_DIRS_OVERRIDE+x}" ]; then
	ADDED_NM_DIRS="$NM_DIRS_OVERRIDE"
else
	ADDED_NM_DIRS=$(find . -type d -name node_modules \
		-not -path '*/node_modules/*' \
		-not -path './.git/*' \
		-not -path './.claude/*' \
		-not -path './.vscode-test/*' \
		-not -path './.venv*/*' \
		2>/dev/null | sed 's|^\./||' | sort -u || true)
fi

UNCACHED_NM_DIRS=""
while IFS= read -r nmdir; do
	[ -z "$nmdir" ] && continue
	covered=false
	for p in "${CACHED_DIRS[@]}" "${NM_ALLOWLIST[@]}"; do
		[ -z "$p" ] && continue
		if [ "$nmdir" = "$p" ] || case "$nmdir" in "$p"/*) true ;; *) false ;; esac; then
			covered=true
			break
		fi
	done
	if [[ "$covered" == false ]]; then
		UNCACHED_NM_DIRS="${UNCACHED_NM_DIRS}${nmdir}\n"
	fi
done <<< "$ADDED_NM_DIRS"

# ============================================================================
# SECTION 4: Filter Out Ignored Files
# ============================================================================
# Check each added file against ignore patterns.
# Files matching any pattern are considered "handled" and don't need warnings.

UNCACHED_FILES=""
while IFS= read -r file; do
	[ -z "$file" ] && continue

	IS_IGNORED=false
	for pattern in "${IGNORE_PATTERNS[@]}"; do
		if [[ "$file" == *"$pattern"* ]]; then
			IS_IGNORED=true
			break
		fi
	done

	if [[ "$IS_IGNORED" == false ]]; then
		UNCACHED_FILES="$UNCACHED_FILES$file\n"
	fi
done <<< "$ADDED_FILES"

# ============================================================================
# SECTION 5: Report Results
# ============================================================================
# Show summary and detailed instructions if uncached files are found.

# Count non-empty lines (|| true to handle empty input with set -e)
TOTAL_ADDED=$([ -z "$ADDED_FILES" ] && echo "0" || echo "$ADDED_FILES" | grep -vc '^$' || echo "0")
UNCACHED_COUNT=$([ -z "$UNCACHED_FILES" ] && echo "0" || echo -e "$UNCACHED_FILES" | grep -vc '^$' || echo "0")
UNCACHED_NM_COUNT=$([ -z "$UNCACHED_NM_DIRS" ] && echo "0" || echo -e "$UNCACHED_NM_DIRS" | grep -vc '^$' || echo "0")

echo "Files added outside node_modules: $TOTAL_ADDED"
echo "Files ignored by IGNORE_PATTERNS: $((TOTAL_ADDED - UNCACHED_COUNT))"
echo "Uncached node_modules dirs: $UNCACHED_NM_COUNT"

if [[ $UNCACHED_COUNT -gt 0 ]]; then
	# Found uncached files - show detailed warning with actionable instructions

	echo ""
	echo "❌ ERROR: npm install created $UNCACHED_COUNT files outside node_modules/"
	echo ""
	echo "These files are NOT cached and will be MISSING on cache-hit runs, which is"
	echo "most runs. A build artifact absent on a cache hit breaks the build long after"
	echo "the introducing PR merged green. This check fails the build so the gap is"
	echo "resolved at author time instead of surfacing on main later."
	echo ""
	echo "Files (first 50):"
	echo -e "$UNCACHED_FILES" | grep -v '^$' | head -50
	echo ""
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "ACTION REQUIRED: Choose one of the following:"
	echo ""
	echo "✅ Option A: Add to cache (if tests need these files)"
	echo ""
	echo "   For core/build/test paths:"
	echo "     → Edit .github/cache-scripts/cache-paths.sh"
	echo "       Add to NPM_CORE_PATHS or BUILTINS_PATHS section"
	echo ""
	echo "   For extension paths:"
	echo "     → Volatile extensions (python/assistant/r):"
	echo "       Edit build/npm/dirs.ts → Add to volatileExtensions array"
	echo "       Entire directory will be cached automatically"
	echo ""
	echo "     → Stable extensions:"
	echo "       Already cached automatically! No action needed."
	echo "       All extension directories not in volatileExtensions are cached"
	echo ""
	echo "   Verify your changes:"
	echo "     → Run: .github/cache-scripts/verify-cache-paths.sh"
	echo ""
	echo "❌ Option B: Ignore (if tests don't need these files)"
	echo ""
	echo "   Add pattern to IGNORE_PATTERNS in this file:"
	echo "     → .github/cache-scripts/check-uncached-artifacts.sh (Section 3, line ~100)"
	echo ""
	echo "   Common patterns to ignore:"
	echo "     • Temporary files: \".tmp\", \".log\""
	echo "     • Generated docs: \"docs/generated\""
	echo "     • Test fixtures: \"test/fixtures/generated\""
	echo ""
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo ""
fi

if [[ $UNCACHED_NM_COUNT -gt 0 ]]; then
	# Found node_modules dirs that no cache path covers (the #15065 failure mode).

	echo ""
	echo "❌ ERROR: npm install created $UNCACHED_NM_COUNT node_modules dir(s) that no cache covers"
	echo ""
	echo "A workspace/submodule node_modules that isn't under a cache-paths.sh entry is"
	echo "restored EMPTY on a cache hit. If any cached build output imports from it at"
	echo "runtime, the artifact loads and then dies with ERR_MODULE_NOT_FOUND -- exactly"
	echo "how #15065 broke ext-host on unrelated PRs."
	echo ""
	echo "Uncached node_modules dirs:"
	echo -e "$UNCACHED_NM_DIRS" | grep -v '^$' | sed 's/^/  → /'
	echo ""
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "ACTION REQUIRED: Choose one of the following:"
	echo ""
	echo "✅ Option A: Cache it (if anything imports from it at build OR runtime)"
	echo "     → Add the dir to NPM_CORE_PATHS in .github/cache-scripts/cache-paths.sh"
	echo "       (for a submodule-hosted dir, confirm the submodule gitlink is in the key)"
	echo ""
	echo "❌ Option B: Accept it (build-tool deps only, never loaded on a cache-hit run)"
	echo "     → Add the dir to NM_ALLOWLIST in this file (Section 3.5), with a one-line"
	echo "       rationale for why a missing copy can't break a cache-hit run."
	echo ""
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo ""
fi

# Write a combined GitHub Step Summary if either check tripped.
if [[ $UNCACHED_COUNT -gt 0 || $UNCACHED_NM_COUNT -gt 0 ]]; then
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		{
			echo "## ❌ Uncached Postinstall Artifacts Detected"
			echo ""
			echo "npm install produced artifacts that aren't cached and will be missing on cache-hit runs:"
			echo "- **$UNCACHED_COUNT** file(s) outside node_modules/"
			echo "- **$UNCACHED_NM_COUNT** uncached node_modules dir(s)"
			echo ""
			echo "**Where to look:** In the \`${GITHUB_JOB:-unit}\` job, expand the \"🔍 Check for uncached postinstall artifacts\" step for the list and next steps (cache the path, or add an ignore/allowlist entry)."
		} >> "$GITHUB_STEP_SUMMARY"
	fi

	# Fail the build. An uncached artifact goes missing on cache-hit runs (the common
	# case) and breaks the build after the introducing PR merged green. Resolve it at
	# author time: cache the path (cache-paths.sh), or -- if tests genuinely don't need
	# it -- add it to IGNORE_PATTERNS (files) or NM_ALLOWLIST (node_modules dirs).
	exit 1
else
	echo "✅ No uncached artifacts detected"
	echo ""
	echo "All files created by postinstall scripts are properly cached or ignored."
fi
