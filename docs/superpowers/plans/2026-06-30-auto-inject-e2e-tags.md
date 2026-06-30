# Auto-inject e2e feature tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive the correct `@:feature-name` e2e tags from a PR's changed files and inject them into `pr-tags-parse.sh`, so the right suites run even when the author forgets to tag the PR body.

**Architecture:** Pure string-in/string-out bash helpers (no `gh`, no GitHub Actions side effects) live in a sourceable library and are unit-tested with a zero-dependency bash harness. `pr-tags-parse.sh` sources the library and wires `gh`-fetched data into it. A curated `e2e-tag-paths-map.json` maps path prefixes to feature tags; a nightly guardrail script flags unmapped Positron dirs. A no-match warning comment is posted from the PR workflow.

**Tech Stack:** Bash, `jq` (preinstalled on GitHub-hosted runners), `gh` CLI, GitHub Actions YAML.

## Global Constraints

- **Additive only.** Tag derivation never removes a tag the author specified; it only adds. The author's explicit body tags and the `@:critical` floor are always honored.
- **Minimum correct coverage.** The map's tag *value* per prefix is the smallest correct set (usually one tag). Selection is driven by file *path*, never by the tags written inside a test file.
- **Deterministic, no LLM, no PETE dependency.**
- **ASCII only.** No em-dashes, en-dashes, smart quotes. Use straight quotes and ASCII hyphens.
- **Tabs for indentation** in all shell scripts (matches `pr-tags-parse.sh`).
- **Platform tags** (`@:win`/`@:web`) are detected from the PR body (existing) plus from *added* diff lines in changed `test/e2e/tests/**` files. In test source these appear as `tags.WIN` / `tags.WEB` (enum members), NOT the literal `@:win`/`@:web`.
- **`@:no-auto-tags`** in the PR body disables path-map derivation only; the platform-added-line scan still runs.
- Copyright headers are not required on shell scripts in this repo (none of the existing `scripts/*.sh` carry one); match surrounding files.

---

## File Structure

- `scripts/lib/pr-tags-lib.sh` (NEW) - pure helpers: `derive_map_tags`, `scan_added_platform_tags`, `is_infra_only`, `union_csv_tags`.
- `scripts/test/pr-tags-lib-test.sh` (NEW) - plain-bash unit tests for the library.
- `.github/workflows/e2e-tag-paths-map.json` (NEW) - path-prefix -> feature-tag(s) map.
- `scripts/check-e2e-tag-map.sh` (NEW) - guardrail: lists Positron dirs/extensions and flags any missing a map entry.
- `.github/workflows/e2e-tag-map-check-nightly.yml` (NEW) - nightly run of the guardrail.
- `scripts/pr-tags-parse.sh` (MODIFY) - source the library; derive + union map tags; honor `@:no-auto-tags`; added-line platform scan; emit `no_matches` output.
- `.github/workflows/test-pull-request.yml` (MODIFY) - add a `no_matches` output to the `pr-tags` job and a comment-upsert step; grant `pull-requests: write`.

---

## Task 1: Pure tag-derivation library + unit tests

**Files:**
- Create: `scripts/lib/pr-tags-lib.sh`
- Test: `scripts/test/pr-tags-lib-test.sh`

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces:
  - `derive_map_tags <changed_files_newline> <map_file>` -> echoes comma-separated, de-duplicated, order-stable matched tags (empty if none). Prefix match: a file matches a map key when the path starts with the key.
  - `scan_added_platform_tags <patch_text>` -> echoes `"<win> <web>"`, each `true`/`false`, true iff `tags.WIN`/`tags.WEB` appears on an added (`+`, excluding `+++`) line.
  - `is_infra_only <changed_files_newline>` -> echoes `true`/`false`. True iff every changed file is an infra/doc/lockfile path. Empty input -> `false`.
  - `union_csv_tags <csv_a> <csv_b>` -> echoes de-duplicated, order-stable comma-joined union (a's order first).

- [ ] **Step 1: Write the failing test harness**

Create `scripts/test/pr-tags-lib-test.sh`:

```bash
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: FAIL - `pr-tags-lib.sh` does not exist, so `source` errors with "No such file or directory" and a non-zero exit.

- [ ] **Step 3: Write the library**

Create `scripts/lib/pr-tags-lib.sh`:

```bash
#!/usr/bin/env bash
# Pure helpers for deriving e2e tags from a PR's changed files.
# No `gh`, no $GITHUB_OUTPUT side effects: everything is string-in / string-out
# so it can be unit-tested without network or GitHub Actions context.
# Source this file; do not execute it.

# derive_map_tags <changed_files> <map_file>
#   changed_files: newline-separated repo-relative paths
#   map_file: e2e-tag-paths-map.json -> { "<prefix>": ["@:tag", ...], ... }
# Echoes comma-separated, de-duplicated, order-stable matched tags (empty if
# none). A file matches a map entry when the path starts with the entry's key.
derive_map_tags() {
	local changed="$1" map_file="$2"
	local file prefix tag keys
	local -a out=()
	keys="$(jq -r 'keys[]' "$map_file")"
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		while IFS= read -r prefix; do
			[[ -z "$prefix" ]] && continue
			if [[ "$file" == "$prefix"* ]]; then
				while IFS= read -r tag; do
					[[ -n "$tag" ]] && out+=("$tag")
				done < <(jq -r --arg k "$prefix" '.[$k][]?' "$map_file")
			fi
		done <<< "$keys"
	done <<< "$changed"
	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | awk 'NF && !seen[$0]++' | paste -sd, -
}

# scan_added_platform_tags <patch_text>
#   patch_text: unified-diff text (concatenated patches of e2e test files)
# Echoes "<win> <web>" (each true/false), true iff the tag enum reference
# appears on an ADDED line. Test source uses `tags.WIN` / `tags.WEB`, not the
# literal `@:win` / `@:web`, so match the enum members.
scan_added_platform_tags() {
	local patch="$1" added win=false web=false
	added="$(printf '%s\n' "$patch" | grep '^+' | grep -v '^+++' || true)"
	printf '%s\n' "$added" | grep -q "tags\.WIN" && win=true
	printf '%s\n' "$added" | grep -q "tags\.WEB" && web=true
	echo "$win $web"
}

# is_infra_only <changed_files>
# Echoes "true" iff EVERY changed file is an infra/doc/lockfile path (no feature
# e2e coverage expected). Used only to suppress the no-match warning comment;
# never affects tag derivation. Empty input echoes "false" (be conservative).
is_infra_only() {
	local changed="$1" file any=false
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		any=true
		case "$file" in
			.github/*|scripts/*|docs/*|*.md) ;;
			package-lock.json|*/package-lock.json) ;;
			*) echo false; return 0 ;;
		esac
	done <<< "$changed"
	$any && echo true || echo false
}

# union_csv_tags <csv_a> <csv_b>
# Merges two comma-separated tag lists into one de-duplicated, order-stable
# comma-separated list (a's order first, then new tags from b).
union_csv_tags() {
	local a="$1" b="$2"
	printf '%s\n%s\n' "${a//,/$'\n'}" "${b//,/$'\n'}" \
		| awk 'NF && !seen[$0]++' | paste -sd, -
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: every line `PASS:`, final line `ALL PASS`, exit 0.

- [ ] **Step 5: Lint the scripts**

Run: `command -v shellcheck >/dev/null && shellcheck scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh || echo "shellcheck not installed; skipping"`
Expected: no errors (or the skip message). Fix any reported issues.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add pure helpers for deriving e2e tags from changed files"
```

---

## Task 2: Path-tag map + nightly guardrail

**Files:**
- Create: `.github/workflows/e2e-tag-paths-map.json`
- Create: `scripts/check-e2e-tag-map.sh`
- Create: `.github/workflows/e2e-tag-map-check-nightly.yml`

**Interfaces:**
- Consumes: the map format produced here is read by `derive_map_tags` (Task 1) and by `pr-tags-parse.sh` (Task 3).
- Produces: `scripts/check-e2e-tag-map.sh` exits 0 when every enumerated dir/extension has a map entry, non-zero (listing the gaps) otherwise. Accepts `--warn-only` to always exit 0 while still printing gaps.

- [ ] **Step 1: Create the seed map (high-confidence entries)**

Create `.github/workflows/e2e-tag-paths-map.json`. These are the unambiguous mappings; the audit in Step 5 fills the rest. An empty array means "intentionally no e2e coverage."

```jsonc
{
  "test/e2e/tests/console/": ["@:console"],
  "test/e2e/tests/plots/": ["@:plots"],
  "test/e2e/tests/variables/": ["@:variables"],
  "test/e2e/tests/data-explorer/": ["@:data-explorer"],
  "test/e2e/tests/connections/": ["@:connections"],
  "test/e2e/tests/help/": ["@:help"],
  "test/e2e/tests/outline/": ["@:outline"],
  "test/e2e/tests/output/": ["@:output"],
  "test/e2e/tests/quarto/": ["@:quarto"],
  "test/e2e/tests/sessions/": ["@:sessions"],
  "test/e2e/tests/welcome/": ["@:welcome"],
  "test/e2e/tests/notebooks-positron/": ["@:positron-notebooks"],
  "test/e2e/tests/packages-pane/": ["@:packages-pane"],

  "src/vs/workbench/contrib/positronConsole/": ["@:console"],
  "src/vs/workbench/services/positronConsole/": ["@:console"],
  "src/vs/workbench/contrib/positronPlots/": ["@:plots"],
  "src/vs/workbench/contrib/positronPlotsEditor/": ["@:plots"],
  "src/vs/workbench/services/positronPlots/": ["@:plots"],
  "src/vs/workbench/contrib/positronVariables/": ["@:variables"],
  "src/vs/workbench/services/positronVariables/": ["@:variables"],
  "src/vs/workbench/contrib/positronConnections/": ["@:connections"],
  "src/vs/workbench/services/positronConnections/": ["@:connections"],
  "src/vs/workbench/services/positronDataExplorer/": ["@:data-explorer"],
  "src/vs/workbench/contrib/positronDataExplorerEditor/": ["@:data-explorer"],
  "src/vs/workbench/contrib/positronHelp/": ["@:help"],
  "src/vs/workbench/contrib/positronOutline/": ["@:outline"],
  "src/vs/workbench/services/positronOutline/": ["@:outline"],
  "src/vs/workbench/contrib/positronNotebook/": ["@:positron-notebooks"],
  "src/vs/workbench/contrib/positronPackages/": ["@:packages-pane"],
  "src/vs/workbench/contrib/positronQuarto/": ["@:quarto"],
  "src/vs/workbench/contrib/positronWelcome/": ["@:welcome"],
  "src/vs/workbench/contrib/positronModalDialogs/": ["@:modal"],
  "src/vs/workbench/services/positronModalDialogs/": ["@:modal"],
  "src/vs/workbench/contrib/positronAssistant/": ["@:assistant", "@:posit-assistant"],
  "src/vs/workbench/contrib/positronRuntimeSessions/": ["@:sessions"],
  "src/vs/workbench/contrib/positronSession/": ["@:sessions"],

  "extensions/positron-assistant/": ["@:assistant", "@:posit-assistant"],
  "extensions/positron-connections/": ["@:connections"],
  "extensions/positron-notebooks/": ["@:positron-notebooks"],
  "extensions/positron-reticulate/": ["@:reticulate"],
  "extensions/positron-run-app/": ["@:apps"],
  "extensions/positron-viewer/": ["@:viewer"],
  "extensions/positron-duckdb/": ["@:duck-db"],

  "src/vs/workbench/contrib/positronTelemetry/": [],
  "src/vs/workbench/contrib/positronIdleReporter/": [],
  "src/vs/workbench/contrib/positronKeybindings/": [],
  "src/vs/workbench/contrib/positronLicenseeInfo/": [],
  "src/vs/workbench/contrib/positronPathUtils/": [],
  "src/vs/workbench/contrib/positronStartupDiagnostics/": []
}
```

- [ ] **Step 2: Write the failing guardrail test**

Append a guardrail check to the existing harness. Add to the end of `scripts/test/pr-tags-lib-test.sh`, *before* the `rm -f "$MAP"` line is NOT possible (that file is the lib map); instead create a second small assertion block at the end of the file just before `[[ $fail -eq 0 ]]`:

```bash
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
rm -f "$TMP_MAP"
```

- [ ] **Step 3: Run to verify it fails**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: FAIL on the two new guardrail checks (`check-e2e-tag-map.sh` not found yet).

- [ ] **Step 4: Write the guardrail script**

Create `scripts/check-e2e-tag-map.sh`:

```bash
#!/usr/bin/env bash
# Guardrail: every Positron feature directory and extension must have an entry
# in e2e-tag-paths-map.json (a real tag list OR an explicit [] meaning "no e2e
# coverage by design"). Flags any that are missing so the map can't silently rot.
# Usage: scripts/check-e2e-tag-map.sh [--warn-only]
# Env: MAP_FILE overrides the map path (used by tests).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP_FILE="${MAP_FILE:-$REPO_ROOT/.github/workflows/e2e-tag-paths-map.json}"
WARN_ONLY=false
[[ "${1:-}" == "--warn-only" ]] && WARN_ONLY=true

if [[ ! -f "$MAP_FILE" ]]; then
	echo "Map file not found: $MAP_FILE" >&2
	exit 1
fi

# Enumerate the directories/extensions that should be mapped, as repo-relative
# prefixes with a trailing slash (matching the map's key format).
mapfile -t expected < <(
	cd "$REPO_ROOT" || exit 1
	for d in src/vs/workbench/contrib/positron*/ \
	         src/vs/workbench/services/positron*/ \
	         extensions/positron-*/ \
	         test/e2e/tests/*/; do
		[[ -d "$d" ]] && echo "$d"
	done
)

missing=()
for prefix in "${expected[@]}"; do
	if ! jq -e --arg k "$prefix" 'has($k)' "$MAP_FILE" >/dev/null; then
		missing+=("$prefix")
	fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
	echo "All Positron dirs/extensions are mapped."
	exit 0
fi

echo "The following paths are missing from $(basename "$MAP_FILE"):"
printf '  - %s\n' "${missing[@]}"
echo ""
echo "Add each to the map: a feature tag list (e.g. [\"@:console\"]) or [] if it has no e2e coverage."

$WARN_ONLY && { echo "(--warn-only: not failing)"; exit 0; }
exit 1
```

- [ ] **Step 5: Audit and complete the map**

Run the guardrail to list every unmapped path:

Run: `bash scripts/check-e2e-tag-map.sh || true`

For each flagged path, decide its tag set and add an entry:
1. Read the feature tag list: `grep -E "= '@:" test/e2e/infra/test-runner/test-tags.ts`
2. Find which e2e tests cover the area by grepping for the dir's feature, e.g. `ls test/e2e/tests/` and matching by name; confirm with `grep -rl "tags.PLOTS" test/e2e/tests/`.
3. Assign the **minimum-correct** tag (usually one), or `[]` if the dir is pure plumbing with no e2e coverage.
4. When unsure between two tags, pick the suite whose tests actually exercise the dir's feature; if genuinely none, use `[]`.

Re-run until clean:

Run: `bash scripts/check-e2e-tag-map.sh`
Expected: `All Positron dirs/extensions are mapped.` exit 0.

- [ ] **Step 6: Run the unit harness (guardrail smoke now passes)**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 7: Create the nightly guardrail workflow (warning-only to start)**

Create `.github/workflows/e2e-tag-map-check-nightly.yml`:

```yaml
name: "Nightly: e2e Tag Map Check"

# Flags Positron feature dirs / extensions that have no entry in
# e2e-tag-paths-map.json, so the auto-tagging map can't silently fall out of
# date. Starts in warning-only mode; flip `--warn-only` off (see step in plan)
# once the map is verified clean.

on:
  schedule:
    - cron: "0 2 * * 1-5"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check-map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Check e2e tag map coverage
        run: bash scripts/check-e2e-tag-map.sh --warn-only | tee -a "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/e2e-tag-paths-map.json scripts/check-e2e-tag-map.sh \
        .github/workflows/e2e-tag-map-check-nightly.yml scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add e2e tag path map and nightly coverage guardrail"
```

- [ ] **Step 9: Flip the guardrail to failing (after the map is confirmed clean)**

Once Step 5 reports clean, remove `--warn-only` so the nightly fails on a real gap. In `.github/workflows/e2e-tag-map-check-nightly.yml`, change the run line to:

```yaml
        run: bash scripts/check-e2e-tag-map.sh | tee -a "$GITHUB_STEP_SUMMARY"
```

And update the header comment's "Starts in warning-only mode" sentence to "Fails when a Positron dir/extension is unmapped." Commit:

```bash
git add .github/workflows/e2e-tag-map-check-nightly.yml
git commit -m "chore: enforce e2e tag map coverage in nightly guardrail"
```

---

## Task 3: Wire derivation into pr-tags-parse.sh

**Files:**
- Modify: `scripts/pr-tags-parse.sh`

**Interfaces:**
- Consumes: `derive_map_tags`, `scan_added_platform_tags`, `union_csv_tags` from `scripts/lib/pr-tags-lib.sh` (Task 1); `.github/workflows/e2e-tag-paths-map.json` (Task 2).
- Produces: an additional `no_matches=true|false` line in `$GITHUB_OUTPUT`, consumed by Task 4. `no_matches=true` iff, after all derivation, the resolved feature-tag set is just `@:critical` (nothing else matched and the body had no feature tags).

- [ ] **Step 1: Source the library near the top**

In `scripts/pr-tags-parse.sh`, after the `set -e` line (line 5) and before the env-var reads, add:

```bash
# Pure tag-derivation helpers (unit-tested in scripts/test/pr-tags-lib-test.sh).
source "$(dirname "$0")/lib/pr-tags-lib.sh"
```

- [ ] **Step 2: Add map derivation + opt-out after the @:ark injection block**

In the `else` branch (the `@:all`-not-present path), immediately after the `@:ark` injection `fi` (currently around line 138, before `# Output the tags`), insert:

```bash
	# Auto-inject feature tags derived from the PR's changed files, unless the
	# author opted out with @:no-auto-tags. Additive only -- never removes tags
	# the author specified. Selection is by file PATH, via e2e-tag-paths-map.json.
	if echo "$PR_BODY" | grep -q "@:no-auto-tags"; then
		echo "Found @:no-auto-tags. Skipping path-map tag derivation."
	elif [[ -n "$CHANGED_FILES" ]]; then
		MAP_FILE="$(dirname "$0")/../.github/workflows/e2e-tag-paths-map.json"
		if [[ -f "$MAP_FILE" ]]; then
			MAP_TAGS="$(derive_map_tags "$CHANGED_FILES" "$MAP_FILE")"
			if [[ -n "$MAP_TAGS" ]]; then
				echo "Derived tags from changed files: $MAP_TAGS"
				TAGS="$(union_csv_tags "$TAGS" "$MAP_TAGS")"
			fi
		fi
	fi
```

- [ ] **Step 3: Add the added-line platform scan in the same branch**

Immediately after the block from Step 2, insert the platform scan. This enables the Windows/web jobs when a newly added e2e test carries `tags.WIN` / `tags.WEB`:

```bash
	# Enable Windows/web jobs when a NEWLY ADDED e2e test carries tags.WIN /
	# tags.WEB (read from added diff lines only, so small edits to an existing
	# tagged test don't opt in). Runs regardless of @:no-auto-tags.
	TEST_PATCHES="$(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate \
		--header "Authorization: token $GITHUB_TOKEN" \
		--jq '.[] | select(.filename | startswith("test/e2e/tests/")) | .patch' || true)"
	read -r ADDED_WIN ADDED_WEB <<< "$(scan_added_platform_tags "$TEST_PATCHES")"
	if [[ "$ADDED_WIN" == "true" ]]; then
		echo "Newly added e2e test carries tags.WIN. Enabling Windows tests."
		echo "win_tag_found=true" >> "$GITHUB_OUTPUT"
	fi
	if [[ "$ADDED_WEB" == "true" ]]; then
		echo "Newly added e2e test carries tags.WEB. Enabling web tests."
		echo "web_tag_found=true" >> "$GITHUB_OUTPUT"
	fi
```

- [ ] **Step 4: Emit the no_matches signal**

Still inside the `else` branch, after `echo "Extracted Tags: $TAGS"` (the existing line), add:

```bash
	# Signal the workflow when nothing but the @:critical floor resolved, so it
	# can warn the author that no feature suites were auto-selected.
	if [[ "$TAGS" == "@:critical" ]]; then
		echo "no_matches=true" >> "$GITHUB_OUTPUT"
	else
		echo "no_matches=false" >> "$GITHUB_OUTPUT"
	fi
```

(For the `@:all` branch, `no_matches` is left unset, which Task 4 treats as falsey: an `@:all` PR runs everything, so there is nothing to warn about.)

- [ ] **Step 5: Verify the script parses and runs the library**

Run: `bash -n scripts/pr-tags-parse.sh && echo "syntax OK"`
Expected: `syntax OK`.

Run the library tests again to confirm nothing in the lib regressed:
Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: `ALL PASS`.

- [ ] **Step 6: Manual smoke against a real PR (optional but recommended)**

If `gh` is authenticated locally, dry-run the parse against a recent PR by exporting the env the script reads, pointing `GITHUB_OUTPUT` at a temp file:

```bash
GITHUB_REPOSITORY=posit-dev/positron \
GITHUB_EVENT_PULL_REQUEST_NUMBER=<a-recent-PR-number> \
GITHUB_TOKEN="$(gh auth token)" \
GITHUB_OUTPUT=/tmp/pr-tags-out.txt \
bash scripts/pr-tags-parse.sh
cat /tmp/pr-tags-out.txt
```

Expected: log shows `Derived tags from changed files: ...` for a PR that touched a mapped dir, and `/tmp/pr-tags-out.txt` contains a `tags=` line plus `no_matches=`.

- [ ] **Step 7: Commit**

```bash
git add scripts/pr-tags-parse.sh
git commit -m "feat: auto-inject e2e tags from changed files in pr-tags-parse"
```

---

## Task 4: No-match warning comment in the PR workflow

**Files:**
- Modify: `.github/workflows/test-pull-request.yml`

**Interfaces:**
- Consumes: `no_matches` output from the `pr-tags` job (Task 3).
- Produces: a sticky PR comment (hidden marker `<!-- e2e-auto-tags -->`) that warns on no-match and resolves itself when a later push matches.

- [ ] **Step 1: Expose the `no_matches` output and grant comment permission**

In `.github/workflows/test-pull-request.yml`, in the `pr-tags` job:
- Add to the job's `outputs:` block (alongside `tags:` etc.):

```yaml
      no_matches: ${{ steps.pr-tags.outputs.no_matches }}
```

- Add a `permissions:` block to the `pr-tags` job (it currently has none), so the comment step can write:

```yaml
    permissions:
      contents: read
      pull-requests: write
```

- [ ] **Step 2: Add the comment-upsert step**

Add a final step to the `pr-tags` job, after the existing `Parse Tags from PR Body` step:

```yaml
      - name: Upsert auto-tag advisory comment
        if: ${{ github.event_name == 'pull_request' }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          NO_MATCHES: ${{ steps.pr-tags.outputs.no_matches }}
        run: bash scripts/pr-tags-comment.sh || echo "Comment step failed (non-fatal)."
```

- [ ] **Step 3: Write the comment script**

Create `scripts/pr-tags-comment.sh`:

```bash
#!/usr/bin/env bash
# Upsert a sticky advisory comment about auto-tagging.
# - NO_MATCHES=true  -> warn the author no feature suites were auto-selected.
# - NO_MATCHES=false -> resolve any prior warning (so a stale warning never lingers).
# Suppressed entirely for infra-only PRs. Non-fatal: fork PRs get a read-only
# token, so a failed POST must not break the tags job (caller appends `|| echo`).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$REPO_ROOT/lib/pr-tags-lib.sh"

REPO="${GITHUB_REPOSITORY}"
PR_NUMBER="${PR_NUMBER}"
NO_MATCHES="${NO_MATCHES:-false}"
MARKER="<!-- e2e-auto-tags -->"

CHANGED_FILES="$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate --jq '.[].filename' || true)"
if [[ "$(is_infra_only "$CHANGED_FILES")" == "true" ]]; then
	echo "Infra-only PR; skipping auto-tag advisory comment."
	exit 0
fi

# Find an existing advisory comment (by marker).
EXISTING_ID="$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate \
	--jq ".[] | select(.body | contains(\"${MARKER}\")) | .id" | head -n1 || true)"

if [[ "$NO_MATCHES" == "true" ]]; then
	BODY="${MARKER}
**No e2e feature tags were auto-selected for this PR.** Only \`@:critical\` will run.

If this PR changes a feature with e2e coverage, add the tag(s) to the PR body (see \`test/e2e/infra/test-runner/test-tags.ts\` for the list). To intentionally skip auto-tagging, add \`@:no-auto-tags\`."
else
	# Resolve: only leave a (quiet) note if a prior warning exists.
	[[ -z "$EXISTING_ID" ]] && { echo "Matches found and no prior warning; nothing to do."; exit 0; }
	BODY="${MARKER}
e2e feature tags were auto-selected from this PR's changed files. No action needed."
fi

if [[ -n "$EXISTING_ID" ]]; then
	gh api --method PATCH "repos/${REPO}/issues/comments/${EXISTING_ID}" -f body="$BODY"
else
	gh api --method POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -f body="$BODY"
fi
```

- [ ] **Step 4: Verify script syntax**

Run: `bash -n scripts/pr-tags-comment.sh && echo "syntax OK"`
Expected: `syntax OK`.

- [ ] **Step 5: Validate the workflow YAML**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/test-pull-request.yml || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test-pull-request.yml')); print('YAML OK')"`
Expected: `YAML OK` (or actionlint passes with no errors).

- [ ] **Step 6: Document auto-tagging in the PR template (discoverability)**

Open `.github/pull_request_template.md` and find the section where e2e `@:` tags
are described. Add one short line so authors learn the behavior and escape hatch
without reading the spec. Match the template's existing tone/format; example
wording to adapt:

```markdown
> e2e feature tags are auto-added from your changed files. Add tags here to run more, or `@:no-auto-tags` to opt out.
```

If `.github/PULL_REQUEST_TEMPLATE.md` is a separate (non-symlink) file with its
own tag section, update it too; if the two are identical/symlinked, one edit
covers both.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/test-pull-request.yml scripts/pr-tags-comment.sh .github/pull_request_template.md
git commit -m "feat: post advisory comment when no e2e tags auto-select on a PR"
```

---

## Verification (whole feature)

- [ ] `bash scripts/test/pr-tags-lib-test.sh` -> `ALL PASS`
- [ ] `bash scripts/check-e2e-tag-map.sh` -> `All Positron dirs/extensions are mapped.`
- [ ] `bash -n scripts/pr-tags-parse.sh && bash -n scripts/pr-tags-comment.sh && bash -n scripts/check-e2e-tag-map.sh` -> all `syntax OK`
- [ ] `jq empty .github/workflows/e2e-tag-paths-map.json && echo "map JSON valid"` -> valid
- [ ] `npm run precommit -- scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh scripts/check-e2e-tag-map.sh scripts/pr-tags-comment.sh` (catches unicode/header/format issues the repo enforces)
- [ ] Open a draft test PR touching a mapped source dir; confirm the e2e job's `grep` includes the derived tag and the advisory comment behaves (warn on no-match, resolve on match).
