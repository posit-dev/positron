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
trap 'rm -rf "${MAP:-}" "${TMP_MAP:-}" "${MAP2:-}" "${ENUM:-}" "${TAGS_ONLY_MAP:-}" "${POSIT_FILE:-}" "${MSFT_FILE:-}" "${EMPTY_MAP:-}" "${FALLBACK_ROOT:-}" "${STALE_MAP:-}" "${POSIT_FILE_LATE_HEADER:-}" "${POSIT_FILE_TOO_LATE:-}" "${LAST_MEMBER_ENUM:-}" "${LAST_MEMBER_MAP:-}" "${EMPTY_TESTS_DIR:-}" "${JSON_MAP:-}" "${EMPTY_JSON_MAP:-}" "${CRUFT_ROOT:-}" "${CRUFT_MAP:-}" "${APPLY_DIR:-}" 2>/dev/null || true' EXIT

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

# Illustrative fixture, not synced to the live map. positron-python's parent
# keeps "@:packages-pane" on purpose even though the real map dropped it --
# without it, the parent would match the python_files default below and the
# "kernel default, no packages-pane" test couldn't catch a fallback-to-parent
# regression.
MAP="$(mktemp)"
cat > "$MAP" <<'JSON'
{
  "src/vs/workbench/contrib/positronConsole/": ["@:console"],
  "extensions/positron-assistant/": ["@:assistant"],
  "extensions/positron-supervisor/": ["@:sessions", "@:console", "@:interpreter"],
  "extensions/positron-python/": ["@:interpreter", "@:console", "@:packages-pane"],
  "extensions/positron-python/src/client/positron/packages/": ["@:packages-pane"],
  "extensions/positron-python/python_files/posit/positron/": ["@:console", "@:interpreter"],
  "extensions/positron-python/python_files/posit/positron/matplotlib_backend": ["@:plots"],
  "extensions/positron-python/python_files/posit/positron/data_explorer": ["@:data-explorer"],
  "extensions/positron-python/python_files/posit/positron/variables": ["@:variables"],
  "extensions/positron-python/python_files/posit/positron/_vendor/": [],
  "src/vs/workbench/contrib/positronTelemetry/": []
}
JSON

# --- derive_map_tags ---
assert_eq "single source match" "@:console" \
	"$(derive_map_tags "src/vs/workbench/contrib/positronConsole/foo.ts" "$MAP")"
# Multi-tag propagation, using positron-supervisor's real, current map value
# (@:sessions, @:console, @:interpreter) rather than a synthetic one.
assert_eq "multi-tag extension" "@:sessions,@:console,@:interpreter" \
	"$(derive_map_tags "extensions/positron-supervisor/src/x.ts" "$MAP")"
assert_eq "dedupe across two source files" "@:console" \
	"$(derive_map_tags "$(printf 'src/vs/workbench/contrib/positronConsole/a.ts\nsrc/vs/workbench/contrib/positronConsole/b.ts')" "$MAP")"
assert_eq "empty-value entry yields nothing" "" \
	"$(derive_map_tags "src/vs/workbench/contrib/positronTelemetry/t.ts" "$MAP")"
assert_eq "no match" "" \
	"$(derive_map_tags "src/vs/base/common/uri.ts" "$MAP")"

# Most-specific-wins: a file under a deeper leaf gets ONLY the leaf's tags, not
# the broad parent's -- the leaf overrides the parent for that path.
assert_eq "longest-prefix leaf overrides parent" "@:packages-pane" \
	"$(derive_map_tags "extensions/positron-python/src/client/positron/packages/pipPackageManager.ts" "$MAP")"
# A file under the parent but outside the leaf still gets the parent's full set.
assert_eq "parent still applies outside the leaf" "@:interpreter,@:console,@:packages-pane" \
	"$(derive_map_tags "extensions/positron-python/src/client/positron/session.ts" "$MAP")"
# Two files, one leaf one parent: union of the winning entry per file.
assert_eq "leaf + parent union across files" "@:packages-pane,@:interpreter,@:console" \
	"$(derive_map_tags "$(printf 'extensions/positron-python/src/client/positron/packages/x.ts\nextensions/positron-python/src/client/positron/session.ts')" "$MAP")"

# Three-level layering (parent -> python_files default -> per-feature file leaf).
# A kernel-side feature file wins with its precise tag, dropping the coarser
# ancestor tags.
assert_eq "python_files feature file: matplotlib -> plots" "@:plots" \
	"$(derive_map_tags "extensions/positron-python/python_files/posit/positron/matplotlib_backend.py" "$MAP")"
assert_eq "python_files feature file: data_explorer_comm -> data-explorer" "@:data-explorer" \
	"$(derive_map_tags "extensions/positron-python/python_files/posit/positron/data_explorer_comm.py" "$MAP")"
assert_eq "python_files feature file: variables -> variables" "@:variables" \
	"$(derive_map_tags "extensions/positron-python/python_files/posit/positron/variables.py" "$MAP")"
# Kernel plumbing with no feature leaf falls to the python_files default
# (console+interpreter), NOT the parent's packages-pane.
assert_eq "python_files plumbing -> kernel default, no packages-pane" "@:console,@:interpreter" \
	"$(derive_map_tags "extensions/positron-python/python_files/posit/positron/positron_ipkernel.py" "$MAP")"
# Vendored code under python_files contributes nothing.
assert_eq "python_files _vendor -> nothing" "" \
	"$(derive_map_tags "extensions/positron-python/python_files/posit/positron/_vendor/foo.py" "$MAP")"
# The TS-client packages leaf is unaffected by the python_files entries.
assert_eq "src/client packages leaf still wins" "@:packages-pane" \
	"$(derive_map_tags "extensions/positron-python/src/client/positron/packages/pip.ts" "$MAP")"

# Test files and lockfiles never contribute to derivation (a test-only or
# lockfile-only change should not auto-select a feature suite).
assert_eq "co-located vitest ignored" "" \
	"$(derive_map_tags "src/vs/workbench/contrib/positronConsole/test/browser/x.vitest.ts" "$MAP")"
assert_eq "co-located .test.ts ignored" "" \
	"$(derive_map_tags "extensions/positron-python/src/test/positron/x.unit.test.ts" "$MAP")"
assert_eq "lockfile ignored" "" \
	"$(derive_map_tags "extensions/positron-assistant/package-lock.json" "$MAP")"
# Source plus its co-located test: source still derives, test contributes nothing.
assert_eq "source derives, its test is skipped" "@:packages-pane" \
	"$(derive_map_tags "$(printf 'extensions/positron-python/src/client/positron/packages/uv.ts\nextensions/positron-python/src/test/positron/uv.unit.test.ts')" "$MAP")"

# --- is_derivable_source ---
assert_eq "derivable: plain source" "true" \
	"$(is_derivable_source "src/vs/workbench/contrib/positronConsole/x.ts")"
assert_eq "non-derivable: test dir" "false" \
	"$(is_derivable_source "src/vs/foo/test/browser/x.ts")"
assert_eq "non-derivable: tests dir" "false" \
	"$(is_derivable_source "extensions/positron-python/src/tests/x.py")"
assert_eq "non-derivable: .test.ts" "false" \
	"$(is_derivable_source "src/vs/foo/x.test.ts")"
assert_eq "non-derivable: .vitest.tsx" "false" \
	"$(is_derivable_source "src/vs/foo/x.vitest.tsx")"
assert_eq "non-derivable: package-lock" "false" \
	"$(is_derivable_source "extensions/positron-assistant/package-lock.json")"
assert_eq "non-derivable: uv.lock" "false" \
	"$(is_derivable_source "extensions/positron-python/python_files/posit/uv.lock")"

# --- scan_added_platform_tags ---
PATCH_WIN=$'@@ -1 +1,2 @@\n+test.describe("x", { tag: [tags.WIN] }, () => {})\n-old line'
assert_eq "added win only" "true false" "$(scan_added_platform_tags "$PATCH_WIN")"
PATCH_REMOVED=$'@@ -1 +0,0 @@\n-test.describe("x", { tag: [tags.WEB] }, () => {})'
assert_eq "removed line not counted" "false false" "$(scan_added_platform_tags "$PATCH_REMOVED")"
PATCH_BOTH=$'@@ -0 +1,2 @@\n+const a = tags.WIN;\n+const b = tags.WEB;'
assert_eq "added win and web" "true true" "$(scan_added_platform_tags "$PATCH_BOTH")"
# Regression for #14731: an unrelated same-line edit reprints tags.WIN/tags.WEB.
PATCH_SAME_LINE_EDIT=$'@@ -1 +1 @@\n-\ttag: [tags.POSIT_ASSISTANT, tags.ASSISTANT, tags.WEB, tags.WIN],\n+\ttag: [tags.ASSISTANT, tags.WEB, tags.WIN],'
assert_eq "same-line edit keeping win/web is not newly added" "false false" \
	"$(scan_added_platform_tags "$PATCH_SAME_LINE_EDIT")"
PATCH_WIN_ADDED_TO_EXISTING=$'@@ -1 +1 @@\n-\ttag: [tags.ASSISTANT],\n+\ttag: [tags.ASSISTANT, tags.WIN],'
assert_eq "win added to existing tag array is newly added" "true false" \
	"$(scan_added_platform_tags "$PATCH_WIN_ADDED_TO_EXISTING")"
# WEB-only mirror -- WIN and WEB are scored independently.
PATCH_SAME_LINE_EDIT_WEB_ONLY=$'@@ -1 +1 @@\n-\ttag: [tags.OLD, tags.ASSISTANT, tags.WEB],\n+\ttag: [tags.ASSISTANT, tags.WEB],'
assert_eq "same-line edit keeping web-only is not newly added" "false false" \
	"$(scan_added_platform_tags "$PATCH_SAME_LINE_EDIT_WEB_ONLY")"
# Same-line swap: WIN dropped, WEB added -- must not couple the two checks.
PATCH_SAME_LINE_SWAP=$'@@ -1 +1 @@\n-\ttag: [tags.ASSISTANT, tags.WIN],\n+\ttag: [tags.ASSISTANT, tags.WEB],'
assert_eq "same-line swap: web newly added, win newly removed (not added)" "false true" \
	"$(scan_added_platform_tags "$PATCH_SAME_LINE_SWAP")"
# Two hunks in the SAME file: one edits an existing tag array (unrelated
# removal keeps tags.WIN), the other genuinely adds a new tags.WIN test. The
# unrelated hunk must not mask the real addition in the other hunk.
PATCH_TWO_HUNKS=$'@@ -1 +1 @@\n-\ttag: [tags.OLD, tags.ASSISTANT, tags.WIN],\n+\ttag: [tags.ASSISTANT, tags.WIN],\n@@ -20 +20,2 @@\n+test.describe("new win test", { tag: [tags.WIN] }, () => {})'
assert_eq "genuine add in one hunk survives unrelated edit in another hunk, same file" "true false" \
	"$(scan_added_platform_tags "$PATCH_TWO_HUNKS")"

# --- scan_added_platform_tags_across_files ---
assert_eq "across_files: single genuine add" "true false" \
	"$(scan_added_platform_tags_across_files "$PATCH_WIN")"
assert_eq "across_files: no files" "false false" \
	"$(scan_added_platform_tags_across_files)"
# Why this function exists: concatenating both files' patches before scanning
# would see tags.WIN on file b's removed line and wrongly suppress file a's add.
FILE_A_GENUINE_WIN=$'@@ -0 +1 @@\n+test.describe("new win test", { tag: [tags.WIN] }, () => {})'
FILE_B_UNRELATED_EDIT_MENTIONS_WIN=$'@@ -1 +1 @@\n-\ttag: [tags.OLD, tags.ASSISTANT, tags.WIN],\n+\ttag: [tags.ASSISTANT, tags.WIN],'
assert_eq "across_files: genuine add in one file survives unrelated edit in another" "true false" \
	"$(scan_added_platform_tags_across_files "$FILE_A_GENUINE_WIN" "$FILE_B_UNRELATED_EDIT_MENTIONS_WIN")"
assert_eq "across_files: no genuine addition anywhere stays false" "false false" \
	"$(scan_added_platform_tags_across_files "$PATCH_SAME_LINE_EDIT" "$FILE_B_UNRELATED_EDIT_MENTIONS_WIN")"

# --- is_infra_only ---
assert_eq "infra only" "true" "$(is_infra_only "$(printf '.github/workflows/x.yml\ndocs/y.md')")"
assert_eq "mixed not infra" "false" "$(is_infra_only "$(printf 'docs/y.md\nsrc/vs/z.ts')")"
assert_eq "empty is not infra" "false" "$(is_infra_only "")"

# --- union_csv_tags ---
assert_eq "union dedup order-stable" "@:critical,@:console,@:plots" \
	"$(union_csv_tags "@:critical,@:console" "@:console,@:plots")"
assert_eq "union with empty b" "@:critical" "$(union_csv_tags "@:critical" "")"
# Single-list dedup (union with empty b) collapses an internal repeat -- the
# idiom pr-tags-parse.sh / pr-e2e-comment.sh use so an author+derived overlap
# (e.g. @:ark from both) isn't shown twice.
assert_eq "union collapses internal dup" "@:critical,@:ark,@:debug" \
	"$(union_csv_tags "@:critical,@:ark,@:debug,@:ark" "")"

# --- valid_enum_tags / split_valid_invalid_tags ---
ENUM="$(mktemp)"
cat > "$ENUM" <<'TS'
export enum TestTags {
	CONSOLE = '@:console',
	CRITICAL = '@:critical',
	ASSISTANT = '@:assistant',
}
TS
assert_eq "valid_enum_tags: parses and sorts enum values" "$(printf '@:assistant\n@:console\n@:critical')" \
	"$(valid_enum_tags "$ENUM")"
assert_eq "valid_enum_tags: missing file yields nothing" "" "$(valid_enum_tags "/nonexistent/test-tags.ts")"

assert_eq "split: all valid, no invalid side" "@:console,@:critical|" \
	"$(split_valid_invalid_tags "@:console,@:critical" "$ENUM")"
assert_eq "split: one typo isolated to invalid side" "@:console|@:consle" \
	"$(split_valid_invalid_tags "@:console,@:consle" "$ENUM")"
assert_eq "split: all invalid, no valid side" "|@:foo,@:bar" \
	"$(split_valid_invalid_tags "@:foo,@:bar" "$ENUM")"
assert_eq "split: empty input yields both sides empty" "|" \
	"$(split_valid_invalid_tags "" "$ENUM")"
assert_eq "split: missing enum file treats all tags as invalid" "|@:console" \
	"$(split_valid_invalid_tags "@:console" "/nonexistent/test-tags.ts")"

# --- check-test-tag-map.sh smoke ---
# A map missing a known dir should fail; --warn-only should still exit 0.
TMP_MAP="$(mktemp)"
echo '{}' > "$TMP_MAP"
if MAP_FILE="$TMP_MAP" bash "$HERE/../check-test-tag-map.sh" >/dev/null 2>&1; then
	echo "FAIL: guardrail should exit non-zero on empty map"; fail=1
else
	echo "PASS: guardrail fails on empty map"
fi
if MAP_FILE="$TMP_MAP" bash "$HERE/../check-test-tag-map.sh" --warn-only >/dev/null 2>&1; then
	echo "PASS: guardrail --warn-only exits 0"
else
	echo "FAIL: guardrail --warn-only should exit 0"; fail=1
fi
# --tags-only skips the dir sweep entirely, so an empty map (no dirs, no tags)
# passes -- it's the same PR-time check test-pull-request.yml runs.
if MAP_FILE="$TMP_MAP" bash "$HERE/../check-test-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "PASS: guardrail --tags-only skips the dir sweep"
else
	echo "FAIL: guardrail --tags-only should exit 0 on an empty map"; fail=1
fi
# A map with one genuinely-tracked key and one that points nowhere: --tags-only
# skips staleness (same tree-wide-coupling reasoning as the dir sweep), full
# mode catches the stale one and leaves the real one alone.
STALE_MAP="$(mktemp)"
cat > "$STALE_MAP" <<'JSON'
{
  "scripts/lib/pr-tags-lib.sh": [],
  "definitely/not/a/real/path/": []
}
JSON
if MAP_FILE="$STALE_MAP" bash "$HERE/../check-test-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "PASS: guardrail --tags-only skips the staleness check"
else
	echo "FAIL: guardrail --tags-only should exit 0 despite a stale entry"; fail=1
fi
STALE_OUTPUT="$(MAP_FILE="$STALE_MAP" bash "$HERE/../check-test-tag-map.sh" 2>&1)"
if printf '%s' "$STALE_OUTPUT" | grep -qF "definitely/not/a/real/path/"; then
	echo "PASS: guardrail flags a stale map entry"
else
	echo "FAIL: guardrail should flag the stale entry"; fail=1
fi
if printf '%s' "$STALE_OUTPUT" | grep -qF "scripts/lib/pr-tags-lib.sh"; then
	echo "FAIL: guardrail should not flag a genuinely-tracked entry as stale"; fail=1
else
	echo "PASS: guardrail leaves a genuinely-tracked entry alone"
fi

# --json emits a machine-readable envelope instead of the human report, for
# the auto-fix workflow to consume. One entry exercises stale + invalid_tags
# together; missing[] is left unasserted on content (the real repo tree makes
# it large against this near-empty map) beyond "is an array".
JSON_MAP="$(mktemp)"
cat > "$JSON_MAP" <<'JSON'
{
  "scripts/lib/pr-tags-lib.sh": [],
  "definitely/not/a/real/path/": ["@:not-a-real-tag"]
}
JSON
JSON_OUTPUT="$(MAP_FILE="$JSON_MAP" bash "$HERE/../check-test-tag-map.sh" --json 2>&1)"
if printf '%s' "$JSON_OUTPUT" | jq -e '.stale == ["definitely/not/a/real/path/"]' >/dev/null 2>&1; then
	echo "PASS: --json reports the stale entry"
else
	echo "FAIL: --json should report the stale entry"; fail=1
fi
if printf '%s' "$JSON_OUTPUT" | jq -e '.invalid_tags == ["@:not-a-real-tag"]' >/dev/null 2>&1; then
	echo "PASS: --json reports the invalid tag"
else
	echo "FAIL: --json should report the invalid tag"; fail=1
fi
if printf '%s' "$JSON_OUTPUT" | jq -e '.missing | type == "array" and length > 0' >/dev/null 2>&1; then
	echo "PASS: --json reports missing as a non-empty array"
else
	echo "FAIL: --json should report missing as a non-empty array"; fail=1
fi
if MAP_FILE="$JSON_MAP" bash "$HERE/../check-test-tag-map.sh" --json >/dev/null 2>&1; then
	echo "FAIL: --json should still exit non-zero on drift"; fail=1
else
	echo "PASS: --json still exits non-zero on drift"
fi
if MAP_FILE="$JSON_MAP" bash "$HERE/../check-test-tag-map.sh" --json --warn-only >/dev/null 2>&1; then
	echo "PASS: --json --warn-only exits 0"
else
	echo "FAIL: --json --warn-only should exit 0"; fail=1
fi
EMPTY_JSON_MAP="$(mktemp)"
echo '{}' > "$EMPTY_JSON_MAP"
EMPTY_JSON_OUTPUT="$(MAP_FILE="$EMPTY_JSON_MAP" bash "$HERE/../check-test-tag-map.sh" --json --tags-only 2>&1)"
if printf '%s' "$EMPTY_JSON_OUTPUT" | jq -e '. == {missing: [], stale: [], invalid_tags: [], untested_tags: [], unresolved_tags: []}' >/dev/null 2>&1; then
	echo "PASS: --json --tags-only on an empty map reports all-empty arrays"
else
	echo "FAIL: --json --tags-only on an empty map should report all-empty arrays"; fail=1
fi
rm -f "$JSON_MAP" "$EMPTY_JSON_MAP"

# --tags-only still fails on a map tag that isn't a real TestTags member.
TAGS_ONLY_MAP="$(mktemp)"
echo '{"foo/bar/": ["@:not-a-real-tag"]}' > "$TAGS_ONLY_MAP"
if MAP_FILE="$TAGS_ONLY_MAP" bash "$HERE/../check-test-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "FAIL: guardrail --tags-only should fail on an invalid map tag"; fail=1
else
	echo "PASS: guardrail --tags-only fails on an invalid map tag"
fi
# The real map's tags should all be valid -- guards against tag rot (a typo'd
# or renamed tag) as an automated CI gate. Deliberately --tags-only, NOT a full
# dir-sweep: CI runs this against a merge-with-main tree, and the full sweep
# depends on the ENTIRE tree staying mapped, including dirs added by unrelated
# PRs that landed on main after this repo's map was last audited -- exactly the
# live-tree coupling check-test-tag-map.sh's own header warns about (the full
# sweep runs weekly/on-demand, not per-PR CI, for that reason). Asserting it
# here would make this suite fail on any PR whenever main drifts, regardless
# of what that PR touches.
if bash "$HERE/../check-test-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "PASS: guardrail's tag validity check passes on the real map"
else
	echo "FAIL: guardrail should exit 0 on the real map's tags"; fail=1
fi

# The enum's LAST member has no trailing comma before the closing brace --
# the untested-tag check must still resolve its name instead of silently
# skipping it (regression check for the comma-anchored grep).
LAST_MEMBER_ENUM="$(mktemp)"
cat > "$LAST_MEMBER_ENUM" <<'TS'
export enum TestTags {
	FOO = '@:foo',
	LAST_ONE = '@:last-one'
}
TS
LAST_MEMBER_MAP="$(mktemp)"
echo '{"some/dir/": ["@:last-one"]}' > "$LAST_MEMBER_MAP"
EMPTY_TESTS_DIR="$(mktemp -d)"
LAST_MEMBER_OUTPUT="$(MAP_FILE="$LAST_MEMBER_MAP" ENUM_FILE="$LAST_MEMBER_ENUM" TESTS_DIR="$EMPTY_TESTS_DIR" bash "$HERE/../check-test-tag-map.sh" --tags-only 2>&1)"
if printf '%s' "$LAST_MEMBER_OUTPUT" | grep -qF "@:last-one"; then
	echo "PASS: guardrail resolves the enum's last member (no trailing comma)"
else
	echo "FAIL: guardrail should flag @:last-one as untested, not skip it silently"; fail=1
fi
if printf '%s' "$LAST_MEMBER_OUTPUT" | grep -q "could not resolve"; then
	echo "FAIL: guardrail should not report an unresolved lookup for a well-formed enum"; fail=1
else
	echo "PASS: guardrail reports no unresolved lookups for a well-formed enum"
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
# Categorical infra locations are excluded (no map entry needed).
assert_eq "dir_of: base/ positron -> empty" "" "$(positron_dir_of "src/vs/base/browser/positron/dom.ts")"
assert_eq "dir_of: workbench/api positron -> empty" "" "$(positron_dir_of "src/vs/workbench/api/common/positron/x.ts")"
assert_eq "dir_of: positron-dts -> empty" "" "$(positron_dir_of "src/positron-dts/positron.d.ts")"

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

# --- owner_root_dir_of (pure, no FS access; naming-convention-independent) ---
assert_eq "owner_root_dir_of: contrib, no positron in name" "src/vs/workbench/contrib/markdown/" \
	"$(owner_root_dir_of "src/vs/workbench/contrib/markdown/common/x.ts")"
assert_eq "owner_root_dir_of: services, no positron in name" "src/vs/workbench/services/runtimeSession/" \
	"$(owner_root_dir_of "src/vs/workbench/services/runtimeSession/common/x.ts")"
assert_eq "owner_root_dir_of: editor/contrib" "src/vs/editor/contrib/foo/" \
	"$(owner_root_dir_of "src/vs/editor/contrib/foo/browser/x.ts")"
assert_eq "owner_root_dir_of: extensions" "extensions/authentication/" \
	"$(owner_root_dir_of "extensions/authentication/src/x.ts")"
assert_eq "owner_root_dir_of: browser" "src/vs/workbench/browser/foo/" \
	"$(owner_root_dir_of "src/vs/workbench/browser/foo/x.ts")"
assert_eq "owner_root_dir_of: platform" "src/vs/platform/foo/" \
	"$(owner_root_dir_of "src/vs/platform/foo/common/x.ts")"
assert_eq "owner_root_dir_of: outside known roots -> empty" "" \
	"$(owner_root_dir_of "src/vs/base/common/uri.ts")"
# Matches positron_dir_of's own convention: a test/ subfolder NESTED inside a
# real feature dir is not excluded (positron_dir_of doesn't exclude
# "positronFoo/test/browser/x.ts" either) -- only a test/ dir AT the root
# level is, since that's VS Code's shared test-fixture location, not a feature.
assert_eq "owner_root_dir_of: first-level test dir -> empty" "" \
	"$(owner_root_dir_of "src/vs/workbench/contrib/test/common/x.ts")"
assert_eq "owner_root_dir_of: non-src/extensions -> empty" "" \
	"$(owner_root_dir_of "docs/x.md")"

# --- is_posit_owned_file ---
POSIT_FILE="$(mktemp)"
cat > "$POSIT_FILE" <<'HDR'
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
HDR
MSFT_FILE="$(mktemp)"
cat > "$MSFT_FILE" <<'HDR'
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
HDR
assert_eq "is_posit_owned_file: Posit header" "true" "$(is_posit_owned_file "$POSIT_FILE")"
assert_eq "is_posit_owned_file: Microsoft header" "false" "$(is_posit_owned_file "$MSFT_FILE")"
assert_eq "is_posit_owned_file: missing file" "false" "$(is_posit_owned_file "/nonexistent/file.ts")"
# Must scan the same window as file-origin.sh (head -20), not less -- a header
# past line 8 but within line 20 should still be detected.
POSIT_FILE_LATE_HEADER="$(mktemp)"
{
	for _ in $(seq 1 9); do echo "// filler line"; done
	echo "/*---------------------------------------------------------------------------------------------"
	echo " *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved."
	echo " *--------------------------------------------------------------------------------------------*/"
} > "$POSIT_FILE_LATE_HEADER"
assert_eq "is_posit_owned_file: Posit header past line 8, within line 20" "true" \
	"$(is_posit_owned_file "$POSIT_FILE_LATE_HEADER")"
# A header past line 20 is out of the scan window entirely -- matches
# file-origin.sh's own boundary rather than being a looser/stricter copy of it.
POSIT_FILE_TOO_LATE="$(mktemp)"
{
	for _ in $(seq 1 21); do echo "// filler line"; done
	echo " *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved."
} > "$POSIT_FILE_TOO_LATE"
assert_eq "is_posit_owned_file: Posit header past line 20 not detected" "false" \
	"$(is_posit_owned_file "$POSIT_FILE_TOO_LATE")"

# --- find_unmapped_positron_dirs: naming-convention fallback ---
# A Positron-owned file whose directory has no "positron" in its name is
# invisible to positron_dir_of alone; owner_root_dir_of + is_posit_owned_file
# should still catch it if unmapped. A same-shaped upstream (Microsoft) file
# must NOT be flagged -- naming alone can't tell them apart, so the copyright
# check is what keeps this from flagging every ordinary upstream contrib dir.
# Uses a synthetic tree so this doesn't depend on real repo file contents.
FALLBACK_ROOT="$(mktemp -d)"
mkdir -p "$FALLBACK_ROOT/src/vs/workbench/contrib/legacyRuntime" "$FALLBACK_ROOT/src/vs/workbench/contrib/upstreamThing"
cat > "$FALLBACK_ROOT/src/vs/workbench/contrib/legacyRuntime/x.ts" <<'HDR'
/*
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 */
HDR
cat > "$FALLBACK_ROOT/src/vs/workbench/contrib/upstreamThing/y.ts" <<'HDR'
/*
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 */
HDR
EMPTY_MAP="$(mktemp)"
echo '{}' > "$EMPTY_MAP"
FALLBACK_RESULT="$(cd "$FALLBACK_ROOT" && find_unmapped_positron_dirs "$(printf 'src/vs/workbench/contrib/legacyRuntime/x.ts\nsrc/vs/workbench/contrib/upstreamThing/y.ts')" "$EMPTY_MAP")"
assert_eq "fallback: Posit-owned non-positron-named dir flagged, upstream one isn't" \
	"src/vs/workbench/contrib/legacyRuntime/" "$FALLBACK_RESULT"
# A file that no longer exists on disk (e.g. a stale path) can't be checked
# for a copyright header, so it's skipped rather than guessed at.
assert_eq "fallback: nonexistent file not flagged" "" \
	"$(cd "$FALLBACK_ROOT" && find_unmapped_positron_dirs "src/vs/workbench/contrib/legacyRuntime/gone.ts" "$EMPTY_MAP")"

# --- check-test-tag-map.sh: dir-coverage ignores untracked cruft ---
# The dir-coverage sweep walks the filesystem (`find src extensions`), not
# `git ls-files`, so a leftover on-disk dir from a removed extension (its
# node_modules/ never gets cleaned up by npm) would otherwise be flagged as
# "missing from the map" even though it's not really part of the tree
# anymore. Uses a synthetic git repo since REPO_ROOT is fixed relative to the
# script's own path and can't be redirected via env var.
CRUFT_ROOT="$(mktemp -d)"
mkdir -p "$CRUFT_ROOT/scripts/lib" "$CRUFT_ROOT/extensions/positron-real/src" "$CRUFT_ROOT/extensions/positron-gone/node_modules"
cp "$HERE/../check-test-tag-map.sh" "$CRUFT_ROOT/scripts/check-test-tag-map.sh"
cp "$HERE/../lib/pr-tags-lib.sh" "$CRUFT_ROOT/scripts/lib/pr-tags-lib.sh"
echo 'real' > "$CRUFT_ROOT/extensions/positron-real/src/x.ts"
echo 'cruft' > "$CRUFT_ROOT/extensions/positron-gone/node_modules/leftover.js"
(cd "$CRUFT_ROOT" && git init -q && git add extensions/positron-real && git -c user.email=t@t -c user.name=t commit -q -m init)
CRUFT_MAP="$(mktemp)"
echo '{}' > "$CRUFT_MAP"
CRUFT_OUTPUT="$(cd "$CRUFT_ROOT" && MAP_FILE="$CRUFT_MAP" bash scripts/check-test-tag-map.sh 2>&1)"
if printf '%s' "$CRUFT_OUTPUT" | grep -qF "extensions/positron-gone/"; then
	echo "FAIL: guardrail should not flag an untracked leftover dir as missing"; fail=1
else
	echo "PASS: guardrail ignores untracked leftover dirs"
fi
if printf '%s' "$CRUFT_OUTPUT" | grep -qF "extensions/positron-real/"; then
	echo "PASS: guardrail still flags a genuinely-tracked unmapped dir"
else
	echo "FAIL: guardrail should flag the tracked-but-unmapped dir"; fail=1
fi
rm -rf "$CRUFT_ROOT" "$CRUFT_MAP"

# --- apply-test-tag-map-fixes.mjs (stale removal only) ---
# Node (not bash/jq) because the map is hand-curated with blank-line grouping
# that a jq round-trip would flatten -- see the script's own header comment.
APPLY_SCRIPT="$HERE/../apply-test-tag-map-fixes.mjs"
APPLY_DIR="$(mktemp -d)"
cat > "$APPLY_DIR/map.json" <<'JSON'
{
  "src/vs/workbench/contrib/positronConsole/": ["@:console"],
  "src/vs/workbench/contrib/positronPlots/": ["@:plots"],

  "extensions/positron-gone/": [],
  "extensions/positron-real/": ["@:reticulate"]
}
JSON
echo '["extensions/positron-gone/"]' > "$APPLY_DIR/stale.json"
APPLY_OUTPUT="$(node "$APPLY_SCRIPT" --map "$APPLY_DIR/map.json" --stale "$APPLY_DIR/stale.json" 2>&1)"
if node -e "JSON.parse(require('fs').readFileSync('$APPLY_DIR/map.json','utf8')); console.log('ok')" >/dev/null 2>&1; then
	echo "PASS: apply script leaves valid JSON behind"
else
	echo "FAIL: apply script should leave valid JSON behind"; fail=1
fi
if grep -qF '"extensions/positron-gone/"' "$APPLY_DIR/map.json"; then
	echo "FAIL: apply script should remove the stale entry"; fail=1
else
	echo "PASS: apply script removes the stale entry"
fi
if printf '%s' "$APPLY_OUTPUT" | grep -qF '"removed":["extensions/positron-gone/"]'; then
	echo "PASS: apply script reports the removed key"
else
	echo "FAIL: apply script should report the removed key"; fail=1
fi
# The removed entry opened its blank-line-separated group -- the group
# boundary before "positron-real" must survive even though the entry that
# used to carry it is gone. Line-splicing preserves it for free (the blank
# line is never rewritten); this guards against a regression to that.
if [[ "$(grep -c '^$' "$APPLY_DIR/map.json")" -eq 1 ]]; then
	echo "PASS: apply script preserves the blank-line group boundary after removing its first entry"
else
	echo "FAIL: apply script should preserve the blank-line group boundary"; fail=1
fi
cp "$APPLY_DIR/map.json" "$APPLY_DIR/map.before-noop.json"
NOOP_OUTPUT="$(node "$APPLY_SCRIPT" --map "$APPLY_DIR/map.json" 2>&1)"
if printf '%s' "$NOOP_OUTPUT" | grep -qF '"removed":[]'; then
	echo "PASS: apply script reports a no-op with no stale arg"
else
	echo "FAIL: apply script should report a no-op with no stale arg"; fail=1
fi
if diff -q "$APPLY_DIR/map.before-noop.json" "$APPLY_DIR/map.json" >/dev/null; then
	echo "PASS: apply script leaves the file untouched on a no-op"
else
	echo "FAIL: apply script should not rewrite the file when there's nothing to do"; fail=1
fi

# Removing the last entry when the preceding one is a multi-line array leaves a
# dangling comma on the `]` line the single-line splice can't strip, so the
# output would be invalid JSON. The validation backstop must catch that and
# refuse to write rather than corrupt the map.
cat > "$APPLY_DIR/bad-map.json" <<'JSON'
{
  "src/vs/workbench/contrib/positronConsole/": [
    "@:console"
  ],
  "extensions/positron-real/": ["@:reticulate"]
}
JSON
cp "$APPLY_DIR/bad-map.json" "$APPLY_DIR/bad-map.orig.json"
echo '["extensions/positron-real/"]' > "$APPLY_DIR/bad-stale.json"
if node "$APPLY_SCRIPT" --map "$APPLY_DIR/bad-map.json" --stale "$APPLY_DIR/bad-stale.json" >/dev/null 2>&1; then
	echo "FAIL: apply script should refuse to write when a splice would produce invalid JSON"; fail=1
else
	echo "PASS: apply script refuses to write when a splice would produce invalid JSON"
fi
if diff -q "$APPLY_DIR/bad-map.orig.json" "$APPLY_DIR/bad-map.json" >/dev/null; then
	echo "PASS: apply script leaves the map untouched when it refuses"
else
	echo "FAIL: apply script should not modify the map it refused to write"; fail=1
fi

# A stale key whose array spans multiple lines can't be matched by the
# single-line splice. Rather than silently no-op (leaving the drift in place
# while reporting success), the script must fail loudly.
cat > "$APPLY_DIR/multiline-map.json" <<'JSON'
{
  "src/vs/workbench/contrib/positronConsole/": ["@:console"],
  "extensions/positron-gone/": [
    "@:reticulate"
  ]
}
JSON
cp "$APPLY_DIR/multiline-map.json" "$APPLY_DIR/multiline-map.orig.json"
echo '["extensions/positron-gone/"]' > "$APPLY_DIR/multiline-stale.json"
if node "$APPLY_SCRIPT" --map "$APPLY_DIR/multiline-map.json" --stale "$APPLY_DIR/multiline-stale.json" >/dev/null 2>&1; then
	echo "FAIL: apply script should fail loudly on a stale key it can't splice, not no-op"; fail=1
else
	echo "PASS: apply script fails loudly on a multi-line stale key it can't remove"
fi
if diff -q "$APPLY_DIR/multiline-map.orig.json" "$APPLY_DIR/multiline-map.json" >/dev/null; then
	echo "PASS: apply script leaves the map untouched when it can't splice a stale key"
else
	echo "FAIL: apply script should not modify the map when it can't splice a stale key"; fail=1
fi
rm -rf "$APPLY_DIR"

# --- build_tag_reasons ---
assert_eq "reasons: critical is required" "@:critical|required" \
	"$(build_tag_reasons "@:critical" "" "" "false" "false" "false")"
assert_eq "reasons: author tag is body" "@:critical|required,@:quarto|body" \
	"$(build_tag_reasons "@:critical,@:quarto" "@:quarto" "" "false" "false" "false")"
assert_eq "reasons: map tag is files" "@:critical|required,@:console|files" \
	"$(build_tag_reasons "@:critical,@:console" "" "@:console" "false" "false" "false")"
# Author + map overlap: explicit author intent (body) wins over files.
assert_eq "reasons: author+map overlap prefers body" "@:critical|required,@:console|body" \
	"$(build_tag_reasons "@:critical,@:console" "@:console" "@:console" "false" "false" "false")"
assert_eq "reasons: ark injection" "@:critical|required,@:ark|ark" \
	"$(build_tag_reasons "@:critical,@:ark" "" "" "true" "false" "false")"
# @:win typed in the body reads as body, not test-win.
assert_eq "reasons: author-typed win is body" "@:critical|required,@:win|body" \
	"$(build_tag_reasons "@:critical,@:win" "@:win" "" "false" "true" "false")"
# @:win added only by the test scan reads as test-win.
assert_eq "reasons: scan-added win is test-win" "@:critical|required,@:win|test-win" \
	"$(build_tag_reasons "@:critical,@:win" "" "" "false" "true" "false")"
assert_eq "reasons: scan-added web is test-web" "@:critical|required,@:web|test-web" \
	"$(build_tag_reasons "@:critical,@:web" "" "" "false" "false" "true")"
assert_eq "reasons: empty final yields nothing" "" \
	"$(build_tag_reasons "" "" "" "false" "false" "false")"

[[ $fail -eq 0 ]] && echo "ALL PASS"
exit $fail
