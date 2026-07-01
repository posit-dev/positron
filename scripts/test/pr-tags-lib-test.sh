#!/usr/bin/env bash
# Unit tests for scripts/lib/pr-tags-lib.sh.
# Plain bash (no bats) so it runs in CI with zero install. Prints PASS/FAIL per
# check and exits non-zero if any check fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib/pr-tags-lib.sh"

fail=0
# Clean up every temp resource on exit (including SIGINT/SIGTERM), so an
# interrupted run doesn't leave files behind. Vars are empty until each mktemp.
trap 'rm -rf "${MAP:-}" "${TMP_MAP:-}" "${ENUM:-}" "${TROOT:-}" "${MAP2:-}" 2>/dev/null || true' EXIT

assert_eq() {
	local desc="$1" expected="$2" actual="$3"
	if [[ "$expected" == "$actual" ]]; then
		echo "PASS: $desc"
	else
		echo "FAIL: $desc"
		echo "  expected: [$expected]"
		echo "  actual:   [$actual]"
		fail=1
	fi
}

MAP="$(mktemp)"
cat > "$MAP" <<'JSON'
{
  "src/vs/workbench/contrib/positronConsole/": ["@:console"],
  "extensions/positron-assistant/": ["@:assistant", "@:posit-assistant"],
  "src/vs/workbench/contrib/positronTelemetry/": []
}
JSON

# --- derive_map_tags ---
assert_eq "single source match" "@:console" \
	"$(derive_map_tags "src/vs/workbench/contrib/positronConsole/foo.ts" "$MAP")"
assert_eq "multi-tag extension" "@:assistant,@:posit-assistant" \
	"$(derive_map_tags "extensions/positron-assistant/src/x.ts" "$MAP")"
assert_eq "dedupe across two source files" "@:console" \
	"$(derive_map_tags "$(printf 'src/vs/workbench/contrib/positronConsole/a.ts\nsrc/vs/workbench/contrib/positronConsole/b.ts')" "$MAP")"
assert_eq "empty-value entry yields nothing" "" \
	"$(derive_map_tags "src/vs/workbench/contrib/positronTelemetry/t.ts" "$MAP")"
assert_eq "no match" "" \
	"$(derive_map_tags "src/vs/base/common/uri.ts" "$MAP")"

# --- scan_added_platform_tags ---
PATCH_WIN=$'@@ -1 +1,2 @@\n+test.describe("x", { tag: [tags.WIN] }, () => {})\n-old line'
assert_eq "added win only" "true false" "$(scan_added_platform_tags "$PATCH_WIN")"
PATCH_REMOVED=$'@@ -1 +0,0 @@\n-test.describe("x", { tag: [tags.WEB] }, () => {})'
assert_eq "removed line not counted" "false false" "$(scan_added_platform_tags "$PATCH_REMOVED")"
PATCH_BOTH=$'@@ -0 +1,2 @@\n+const a = tags.WIN;\n+const b = tags.WEB;'
assert_eq "added win and web" "true true" "$(scan_added_platform_tags "$PATCH_BOTH")"

# --- is_infra_only ---
assert_eq "infra only" "true" "$(is_infra_only "$(printf '.github/workflows/x.yml\ndocs/y.md')")"
assert_eq "mixed not infra" "false" "$(is_infra_only "$(printf 'docs/y.md\nsrc/vs/z.ts')")"
assert_eq "empty is not infra" "false" "$(is_infra_only "")"

# --- union_csv_tags ---
assert_eq "union dedup order-stable" "@:critical,@:console,@:plots" \
	"$(union_csv_tags "@:critical,@:console" "@:console,@:plots")"
assert_eq "union with empty b" "@:critical" "$(union_csv_tags "@:critical" "")"

# --- derive_test_file_tags ---
ENUM="$(mktemp)"
cat > "$ENUM" <<'TS'
export enum TestTags {
	CONSOLE = '@:console',
	SESSIONS = '@:sessions',
	PLOTS = '@:plots',
	JUPYTER = '@:jupyter',
	CRITICAL = '@:critical',
	WEB = '@:web',
	WIN = '@:win',
}
TS
TROOT="$(mktemp -d)"
mkdir -p "$TROOT/test/e2e/tests/console"
cat > "$TROOT/test/e2e/tests/console/a.test.ts" <<'TST'
test.describe('x', { tag: [tags.CONSOLE, tags.SESSIONS, tags.WIN, tags.CRITICAL] }, () => {});
TST
cat > "$TROOT/test/e2e/tests/console/b.test.ts" <<'TST'
test.describe('y', { tag: [tags.JUPYTER, tags.PLOTS] }, () => {});
TST

# Feature tags resolved; platform (WIN), special (CRITICAL), build-variant (JUPYTER) excluded; deduped.
assert_eq "test-file feature tags only" "@:console,@:sessions,@:plots" \
	"$(derive_test_file_tags "$(printf 'test/e2e/tests/console/a.test.ts\ntest/e2e/tests/console/b.test.ts')" "$TROOT" "$ENUM")"
# A changed file outside test/e2e/tests/ contributes nothing.
assert_eq "non-test path ignored" "" \
	"$(derive_test_file_tags "src/vs/foo.ts" "$TROOT" "$ENUM")"
# A changed test path that no longer exists on disk is skipped.
assert_eq "missing file ignored" "" \
	"$(derive_test_file_tags "test/e2e/tests/console/ghost.test.ts" "$TROOT" "$ENUM")"

# --- check-e2e-tag-map.sh smoke ---
# A map missing a known dir should fail; --warn-only should still exit 0.
TMP_MAP="$(mktemp)"
echo '{}' > "$TMP_MAP"
if MAP_FILE="$TMP_MAP" bash "$HERE/../check-e2e-tag-map.sh" >/dev/null 2>&1; then
	echo "FAIL: guardrail should exit non-zero on empty map"; fail=1
else
	echo "PASS: guardrail fails on empty map"
fi
if MAP_FILE="$TMP_MAP" bash "$HERE/../check-e2e-tag-map.sh" --warn-only >/dev/null 2>&1; then
	echo "PASS: guardrail --warn-only exits 0"
else
	echo "FAIL: guardrail --warn-only should exit 0"; fail=1
fi
# The real (complete) map should pass -- also guards the map staying complete.
if bash "$HERE/../check-e2e-tag-map.sh" >/dev/null 2>&1; then
	echo "PASS: guardrail passes on the complete map"
else
	echo "FAIL: guardrail should exit 0 on the complete map"; fail=1
fi

# --- positron_dir_of (shared primitive) ---
assert_eq "dir_of: file under contrib" "src/vs/workbench/contrib/positronConsole/" \
	"$(positron_dir_of "src/vs/workbench/contrib/positronConsole/browser/x.ts")"
assert_eq "dir_of: bare dir path (positron last)" "src/vs/workbench/browser/positronDataExplorer/" \
	"$(positron_dir_of "src/vs/workbench/browser/positronDataExplorer")"
assert_eq "dir_of: editor/contrib file" "src/vs/editor/contrib/positronHelp/" \
	"$(positron_dir_of "src/vs/editor/contrib/positronHelp/x.ts")"
assert_eq "dir_of: extension" "extensions/positron-python/" \
	"$(positron_dir_of "extensions/positron-python/src/x.ts")"
assert_eq "dir_of: non-positron -> empty" "" "$(positron_dir_of "src/vs/base/common/uri.ts")"
assert_eq "dir_of: test-path -> empty" "" "$(positron_dir_of "src/vs/base/test/common/positron/x.ts")"
assert_eq "dir_of: outside src/extensions -> empty" "" "$(positron_dir_of "docs/x.md")"

# --- find_unmapped_positron_dirs ---
MAP2="$(mktemp)"
cat > "$MAP2" <<'JSON'
{
  "src/vs/workbench/contrib/positronConsole/": ["@:console"],
  "src/vs/workbench/contrib/positronTelemetry/": [],
  "src/vs/workbench/services/positronConsole/": ["@:console"]
}
JSON
# A mapped dir (incl. a [] entry) is NOT flagged; an unmapped positron dir IS.
assert_eq "unmapped positron dir flagged" "src/vs/workbench/contrib/positronFoo/" \
	"$(find_unmapped_positron_dirs "$(printf 'src/vs/workbench/contrib/positronConsole/a.ts\nsrc/vs/workbench/contrib/positronFoo/b.ts\nsrc/vs/workbench/contrib/positronTelemetry/c.ts')" "$MAP2")"
# A non-Positron path is never flagged.
assert_eq "non-positron path ignored" "" \
	"$(find_unmapped_positron_dirs "src/vs/base/common/uri.ts" "$MAP2")"
# An unmapped extension is flagged.
assert_eq "unmapped extension flagged" "extensions/positron-bar/" \
	"$(find_unmapped_positron_dirs "extensions/positron-bar/src/x.ts" "$MAP2")"
# services/ paths are handled like contrib/: mapped -> not flagged, unmapped -> flagged.
assert_eq "unmapped services dir flagged" "src/vs/workbench/services/positronBaz/" \
	"$(find_unmapped_positron_dirs "$(printf 'src/vs/workbench/services/positronConsole/a.ts\nsrc/vs/workbench/services/positronBaz/b.ts')" "$MAP2")"
# Tree-wide: a positron dir outside contrib/services/extensions (e.g. editor/contrib) is still flagged.
assert_eq "unmapped editor-contrib dir flagged" "src/vs/editor/contrib/positronFoo/" \
	"$(find_unmapped_positron_dirs "src/vs/editor/contrib/positronFoo/browser/x.ts" "$MAP2")"
# Test/build positron dirs are never flagged (not feature source).
assert_eq "test-path positron dir ignored" "" \
	"$(find_unmapped_positron_dirs "src/vs/base/test/common/positron/x.ts" "$MAP2")"

[[ $fail -eq 0 ]] && echo "ALL PASS"
exit $fail
