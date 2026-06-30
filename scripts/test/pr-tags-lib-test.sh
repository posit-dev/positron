#!/usr/bin/env bash
# Unit tests for scripts/lib/pr-tags-lib.sh.
# Plain bash (no bats) so it runs in CI with zero install. Prints PASS/FAIL per
# check and exits non-zero if any check fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib/pr-tags-lib.sh"

fail=0
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
  "test/e2e/tests/console/": ["@:console"],
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
assert_eq "dedupe across source + test" "@:console" \
	"$(derive_map_tags "$(printf 'src/vs/workbench/contrib/positronConsole/a.ts\ntest/e2e/tests/console/b.test.ts')" "$MAP")"
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

rm -f "$MAP"
[[ $fail -eq 0 ]] && echo "ALL PASS"
exit $fail
