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
trap 'rm -rf "${MAP:-}" "${TMP_MAP:-}" "${MAP2:-}" "${ENUM:-}" "${TAGS_ONLY_MAP:-}" "${POSIT_FILE:-}" "${MSFT_FILE:-}" "${EMPTY_MAP:-}" "${FALLBACK_ROOT:-}" "${STALE_MAP:-}" 2>/dev/null || true' EXIT

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
assert_eq "multi-tag extension" "@:assistant,@:posit-assistant" \
	"$(derive_map_tags "extensions/positron-assistant/src/x.ts" "$MAP")"
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
# --tags-only skips the dir sweep entirely, so an empty map (no dirs, no tags)
# passes -- it's the same PR-time check test-pull-request.yml runs.
if MAP_FILE="$TMP_MAP" bash "$HERE/../check-e2e-tag-map.sh" --tags-only >/dev/null 2>&1; then
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
if MAP_FILE="$STALE_MAP" bash "$HERE/../check-e2e-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "PASS: guardrail --tags-only skips the staleness check"
else
	echo "FAIL: guardrail --tags-only should exit 0 despite a stale entry"; fail=1
fi
STALE_OUTPUT="$(MAP_FILE="$STALE_MAP" bash "$HERE/../check-e2e-tag-map.sh" 2>&1)"
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

# --tags-only still fails on a map tag that isn't a real TestTags member.
TAGS_ONLY_MAP="$(mktemp)"
echo '{"foo/bar/": ["@:not-a-real-tag"]}' > "$TAGS_ONLY_MAP"
if MAP_FILE="$TAGS_ONLY_MAP" bash "$HERE/../check-e2e-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "FAIL: guardrail --tags-only should fail on an invalid map tag"; fail=1
else
	echo "PASS: guardrail --tags-only fails on an invalid map tag"
fi
# The real map's tags should all be valid -- guards against tag rot (a typo'd
# or renamed tag) as an automated CI gate. Deliberately --tags-only, NOT a full
# dir-sweep: CI runs this against a merge-with-main tree, and the full sweep
# depends on the ENTIRE tree staying mapped, including dirs added by unrelated
# PRs that landed on main after this repo's map was last audited -- exactly the
# live-tree coupling check-e2e-tag-map.sh's own header warns about (the full
# sweep is LOCAL/MANUAL for that reason). Asserting it here would make this
# suite fail on any PR whenever main drifts, regardless of what that PR touches.
if bash "$HERE/../check-e2e-tag-map.sh" --tags-only >/dev/null 2>&1; then
	echo "PASS: guardrail's tag validity check passes on the real map"
else
	echo "FAIL: guardrail should exit 0 on the real map's tags"; fail=1
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

[[ $fail -eq 0 ]] && echo "ALL PASS"
exit $fail
