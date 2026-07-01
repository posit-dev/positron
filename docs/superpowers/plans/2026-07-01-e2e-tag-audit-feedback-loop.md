# E2E Tag Audit Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly, read-only job that compares each merged PR's author-tagged e2e feature tags against what the path map auto-derives, and reports the divergences to a GitHub job summary + Slack so the map stays accurate over time.

**Architecture:** Three pure helpers added to the existing `scripts/lib/pr-tags-lib.sh` (unit-tested), a `scripts/audit-e2e-tags.sh` generator that reuses the production derivation (`derive_map_tags`/`is_derivable_source`) so the audit can't drift from reality, and a weekly GitHub Actions workflow that runs the generator, writes the report to the job summary, and posts a Slack notification. No auto-editing, no auto-PR, no auto-diff.

**Tech Stack:** Bash (POSIX-ish, `jq`, `awk`, GNU `date`), `gh` CLI, GitHub Actions, Slack `chat.postMessage`.

## Global Constraints

- **Reuse production derivation.** The generator MUST call `derive_map_tags` and `is_derivable_source` from `scripts/lib/pr-tags-lib.sh` - never reimplement tag derivation.
- **Read-only.** The job never writes the map, never edits PRs, never opens issues/PRs. `gh` is used only for reads.
- **Deterministic, no external service in the logic, no LLM.** Same input -> same report.
- **Bash style:** tabs for indentation (match `pr-tags-lib.sh`). No non-ASCII punctuation; use the `:label:` emoji shortcode (renders on both GitHub summaries and Slack) rather than a literal unicode glyph.
- **Depends on** `scripts/lib/pr-tags-lib.sh` as it exists on branch `mi/military-mallow` (PR #14602). Work on branch `mi/e2e-tag-audit` (already cut from it). Rebase onto `main` after #14602 merges.
- **Canonical report header (one contract, both surfaces):** `:label: Test Tag Audit - Week of <Mon D>`. Identical text on Slack and the job summary; the only difference is that Slack wraps `Test Tag Audit` in the run link, the summary renders it as a plain `##` heading.
- **Suppress `+` gaps on non-source PRs** (empty `Entry`). Over-tags (`-`) are unaffected.
- **No suggested diffs.** The report points at the candidate `Entry`; the human writes any map edit.
- **Slack:** channel `#positron-dev`, token secret `SLACK_TOKEN_TEST_STATUS`, via `curl` `chat.postMessage` (mirror `extensions-check-nightly.yml`). Post every week (incl. clean). Failure notice to `#positron-test-results` via `midleman/slack-workflow-status@v3.1.3`.
- **Schedule:** cron `0 12 * * 1` (Mon ~06:00 CT) + `workflow_dispatch`.
- **Assertion style (bash tests):** use the existing `assert_eq "<desc>" "<expected>" "<actual>"` harness in `scripts/test/pr-tags-lib-test.sh`.

---

### Task 1: `csv_minus` primitive

**Files:**
- Modify: `scripts/lib/pr-tags-lib.sh` (add function near `union_csv_tags`, ~line 92)
- Test: `scripts/test/pr-tags-lib-test.sh` (add cases in a new `--- csv_minus ---` block)

**Interfaces:**
- Produces: `csv_minus <a_csv> <b_csv>` -> echoes comma-separated, order-stable (a's order) tags in `a` but not in `b`; de-duplicated; empty string if none.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test/pr-tags-lib-test.sh` (after the `union_csv_tags` block):

```bash
# --- csv_minus ---
assert_eq "csv_minus removes b's tags, keeps a order" "@:a,@:c" \
	"$(csv_minus "@:a,@:b,@:c" "@:b")"
assert_eq "csv_minus empty a" "" "$(csv_minus "" "@:x")"
assert_eq "csv_minus empty b returns a" "@:a,@:b" "$(csv_minus "@:a,@:b" "")"
assert_eq "csv_minus no overlap" "@:a" "$(csv_minus "@:a" "@:b")"
assert_eq "csv_minus full overlap" "" "$(csv_minus "@:a,@:b" "@:b,@:a")"
assert_eq "csv_minus dedups a" "@:a" "$(csv_minus "@:a,@:a" "")"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | grep csv_minus`
Expected: FAIL lines (`csv_minus: command not found` / mismatches)

- [ ] **Step 3: Implement `csv_minus`**

Add to `scripts/lib/pr-tags-lib.sh` after `union_csv_tags`:

```bash
# csv_minus <a_csv> <b_csv>
# Echoes the comma-separated, order-stable (a's order) tags present in a but not
# in b, de-duplicated. Empty if none.
csv_minus() {
	awk -v a="$1" -v b="$2" 'BEGIN {
		nb = split(b, B, ","); for (i = 1; i <= nb; i++) if (B[i] != "") skip[B[i]] = 1
		na = split(a, A, ","); out = ""
		for (i = 1; i <= na; i++) {
			t = A[i]
			if (t != "" && !skip[t] && !seen[t]++) out = out (out == "" ? "" : ",") t
		}
		print out
	}'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | grep -E "csv_minus|FAIL"`
Expected: all `csv_minus` lines PASS, no FAIL

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add csv_minus set-difference helper for tag audit"
```

---

### Task 2: `longest_map_prefix` primitive

**Files:**
- Modify: `scripts/lib/pr-tags-lib.sh` (add after `csv_minus`)
- Test: `scripts/test/pr-tags-lib-test.sh` (the existing `MAP` fixture already has the `positron-python` parent + `.../packages/` leaf needed here)

**Interfaces:**
- Consumes: the map JSON (same shape `derive_map_tags` reads).
- Produces: `longest_map_prefix <file> <map_file>` -> echoes the single longest map key that prefixes `<file>` (the most-specific-wins winner), or empty string if none.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test/pr-tags-lib-test.sh` (after the `csv_minus` block; uses the existing `$MAP` fixture):

```bash
# --- longest_map_prefix ---
assert_eq "longest_map_prefix: leaf wins over parent" \
	"extensions/positron-python/src/client/positron/packages/" \
	"$(longest_map_prefix "extensions/positron-python/src/client/positron/packages/pip.ts" "$MAP")"
assert_eq "longest_map_prefix: parent when no leaf" \
	"extensions/positron-python/" \
	"$(longest_map_prefix "extensions/positron-python/src/client/positron/session.ts" "$MAP")"
assert_eq "longest_map_prefix: no match" "" \
	"$(longest_map_prefix "src/vs/base/common/uri.ts" "$MAP")"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | grep longest_map_prefix`
Expected: FAIL (`longest_map_prefix: command not found`)

- [ ] **Step 3: Implement `longest_map_prefix`**

Add to `scripts/lib/pr-tags-lib.sh` after `csv_minus`:

```bash
# longest_map_prefix <file> <map_file>
# Echoes the single longest map key that prefixes <file> (the most-specific-wins
# winner derive_map_tags would pick for this file), or nothing.
longest_map_prefix() {
	local file="$1" map_file="$2" prefix best=""
	while IFS= read -r prefix; do
		[[ -z "$prefix" ]] && continue
		if [[ "$file" == "$prefix"* ]] && (( ${#prefix} > ${#best} )); then
			best="$prefix"
		fi
	done < <(jq -r 'keys[]' "$map_file")
	printf '%s' "$best"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | grep -E "longest_map_prefix|FAIL"`
Expected: all `longest_map_prefix` lines PASS, no FAIL

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add longest_map_prefix helper for tag audit"
```

---

### Task 3: `tag_ancestor_explained` helper

**Files:**
- Modify: `scripts/lib/pr-tags-lib.sh` (add after `longest_map_prefix`)
- Test: `scripts/test/pr-tags-lib-test.sh` (uses the existing `$MAP` fixture: `positron-python/` supplies `@:interpreter`, the `.../packages/` leaf does not)

**Interfaces:**
- Consumes: `longest_map_prefix`, `is_derivable_source` (both already defined).
- Produces: `tag_ancestor_explained <tag> <changed_files_newline> <map_file>` -> exit 0 (true) iff, for some changed derivable file, the longest matching key does NOT supply `<tag>` but a shorter matching key does (a leaf deliberately narrowed the tag away). Exit 1 otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test/pr-tags-lib-test.sh` (after the `longest_map_prefix` block):

```bash
# --- tag_ancestor_explained ---
# @:interpreter is supplied by the positron-python parent but dropped by the
# .../packages/ leaf, so a packages-only change makes @:interpreter "explained".
if tag_ancestor_explained "@:interpreter" \
	"extensions/positron-python/src/client/positron/packages/pip.ts" "$MAP"; then
	echo "PASS: ancestor-explained true when leaf drops a parent tag"
else
	echo "FAIL: ancestor-explained should be true for dropped parent tag"; fail=1
fi
# The winner supplies @:packages-pane, so it is NOT ancestor-explained.
if tag_ancestor_explained "@:packages-pane" \
	"extensions/positron-python/src/client/positron/packages/pip.ts" "$MAP"; then
	echo "FAIL: ancestor-explained should be false when winner supplies tag"; fail=1
else
	echo "PASS: ancestor-explained false when winner supplies the tag"
fi
# A tag no ancestor supplies is a genuine gap, not explained.
if tag_ancestor_explained "@:plots" \
	"extensions/positron-python/src/client/positron/packages/pip.ts" "$MAP"; then
	echo "FAIL: ancestor-explained should be false for a genuine gap"; fail=1
else
	echo "PASS: ancestor-explained false for a genuine gap"
fi
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | grep -i ancestor`
Expected: FAIL lines (`tag_ancestor_explained: command not found`)

- [ ] **Step 3: Implement `tag_ancestor_explained`**

Add to `scripts/lib/pr-tags-lib.sh` after `longest_map_prefix`:

```bash
# tag_ancestor_explained <tag> <changed_files> <map_file>
# Exit 0 (true) iff, for some changed derivable file, the LONGEST matching map
# key does not supply <tag> but a SHORTER matching key does -- i.e. a leaf
# deliberately narrowed <tag> away (e.g. positron-r/src/testing/ dropping
# @:ark). Used to flag a "+gap" as (review) rather than a real gap.
tag_ancestor_explained() {
	local tag="$1" changed="$2" map_file="$3" file lp k
	while IFS= read -r file; do
		[[ -z "$file" ]] && continue
		[[ "$(is_derivable_source "$file")" == "true" ]] || continue
		lp="$(longest_map_prefix "$file" "$map_file")"
		[[ -z "$lp" ]] && continue
		# Winner already supplies the tag -> this file is not "narrowed".
		jq -r --arg k "$lp" '.[$k][]?' "$map_file" | grep -qxF "$tag" && continue
		while IFS= read -r k; do
			[[ -z "$k" ]] && continue
			[[ "$file" == "$k"* ]] || continue
			(( ${#k} < ${#lp} )) || continue
			if jq -r --arg k "$k" '.[$k][]?' "$map_file" | grep -qxF "$tag"; then
				return 0
			fi
		done < <(jq -r 'keys[]' "$map_file")
	done <<< "$changed"
	return 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | grep -iE "ancestor|FAIL"`
Expected: all three ancestor lines PASS, no FAIL. Also run the full suite once: `bash scripts/test/pr-tags-lib-test.sh 2>&1 | tail -1` -> `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add tag_ancestor_explained helper for tag audit"
```

---

### Task 4: `audit-e2e-tags.sh` report generator

**Files:**
- Create: `scripts/audit-e2e-tags.sh`
- (Validated by manual smoke run, not unit-tested: it is `gh`/formatting glue over the Task 1-3 primitives, per the spec.)

**Interfaces:**
- Consumes: `derive_map_tags`, `is_derivable_source`, `csv_minus`, `longest_map_prefix`, `tag_ancestor_explained` from `scripts/lib/pr-tags-lib.sh`.
- Produces: a Markdown report on stdout (canonical header, summary bullets, divergence table, legend). When `GITHUB_OUTPUT` is set, also appends `examined=`, `clean=`, `under=`, `over=`, `week=` for the workflow to build the Slack message.
- Usage: `audit-e2e-tags.sh [N] [SKIP]` (count window, default `50 0`) or `audit-e2e-tags.sh --since <YYYY-MM-DD>` (date window, used by the weekly job).

- [ ] **Step 1: Create the script**

Create `scripts/audit-e2e-tags.sh`:

```bash
#!/usr/bin/env bash
# Weekly e2e tag audit: compare each merged PR's author-tagged feature tags with
# what the path map auto-derives, and report divergences. Read-only -- never
# edits the map, PRs, or issues.
# Usage:
#   audit-e2e-tags.sh [N] [SKIP]        # last N merged PRs to main, skipping SKIP (default 50 0)
#   audit-e2e-tags.sh --since <date>    # PRs merged on/after ISO date (weekly job)
set -uo pipefail

REPO="${GITHUB_REPOSITORY:-posit-dev/positron}"
SERVER="${GITHUB_SERVER_URL:-https://github.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MAP="${MAP_FILE:-$HERE/../.github/workflows/e2e-tag-paths-map.json}"
# shellcheck source=/dev/null
source "$HERE/lib/pr-tags-lib.sh"

# --- args ---
MODE="count"; N=50; SKIP=0; SINCE=""
if [[ "${1:-}" == "--since" ]]; then
	MODE="since"; SINCE="${2:?--since needs a YYYY-MM-DD date}"
else
	N="${1:-50}"; SKIP="${2:-0}"
fi

# Feature-tag vocabulary = every tag the map can produce; author tags are
# restricted to these so platform/build-variant tags (@:win, @:workbench-*, ...)
# don't count as divergences.
UNIVERSE="$(jq -r '[.[][]] | unique | .[]' "$MAP" | sort -u)"
is_feature_tag() { grep -qxF "$1" <<< "$UNIVERSE"; }

# --- fetch PRs (newest first) as: number \t title \t base64(body) ---
if [[ "$MODE" == "since" ]]; then
	PRS="$(gh pr list --repo "$REPO" --state merged --base main --limit 500 \
		--search "merged:>=$SINCE" \
		--json number,title,body \
		--jq '.[] | [(.number|tostring),(.title|gsub("\t";" ")),(.body // ""|@base64)] | @tsv')"
	WEEK="Week of $(date -u -d "$SINCE" +'%b %-d' 2>/dev/null || echo "$SINCE")"
else
	PRS="$(gh pr list --repo "$REPO" --state merged --base main --limit "$((N + SKIP))" \
		--json number,title,body \
		--jq '.[] | [(.number|tostring),(.title|gsub("\t";" ")),(.body // ""|@base64)] | @tsv' \
		| tail -n +"$((SKIP + 1))")"
	WEEK="recent $N PRs"
fi

examined=0; clean=0; under=0; over=0; rows=""
while IFS=$'\t' read -r num title b64; do
	[[ -z "$num" ]] && continue
	examined=$((examined + 1))
	body="$(printf '%s' "$b64" | base64 -d 2>/dev/null || true)"

	# Author feature tags (map vocabulary only), in author order.
	author="$(printf '%s' "$body" | grep -oE '@:[a-zA-Z0-9_-]+' | awk '!s[$0]++' \
		| while IFS= read -r t; do is_feature_tag "$t" && echo "$t"; done | paste -sd, -)"

	files="$(gh api "repos/$REPO/pulls/$num/files" --paginate --jq '.[].filename' 2>/dev/null || true)"
	auto="$(derive_map_tags "$files" "$MAP" 2>/dev/null || true)"

	# Distinct winning map entries over derivable changed files.
	entry="$(while IFS= read -r f; do
		[[ -z "$f" ]] && continue
		[[ "$(is_derivable_source "$f")" == "true" ]] || continue
		lp="$(longest_map_prefix "$f" "$MAP")"; [[ -n "$lp" ]] && echo "$lp"
	done <<< "$files" | awk 'NF && !s[$0]++' | paste -sd', ' -)"

	gaps="$(csv_minus "$author" "$auto")"
	extras="$(csv_minus "$auto" "$author")"
	# Suppress gaps on non-source PRs (no derivable source changed -> empty entry).
	[[ -z "$entry" ]] && gaps=""

	if [[ -z "$gaps" && -z "$extras" ]]; then clean=$((clean + 1)); continue; fi

	delta=""
	IFS=',' read -ra G <<< "$gaps"
	for g in "${G[@]}"; do
		[[ -z "$g" ]] && continue
		under=$((under + 1))
		if tag_ancestor_explained "$g" "$files" "$MAP"; then
			delta+="+$g (review), "
		else
			delta+="+$g, "
		fi
	done
	IFS=',' read -ra E <<< "$extras"
	for e in "${E[@]}"; do
		[[ -z "$e" ]] && continue
		over=$((over + 1))
		delta+="-$e, "
	done
	delta="${delta%, }"

	rows+="| [#$num]($SERVER/$REPO/pull/$num) | $title | ${author:--} | ${auto:--} | $delta | \`${entry:--}\` |"$'\n'
done <<< "$PRS"

# --- render report (stdout -> job summary) ---
printf '## :label: Test Tag Audit - %s\n\n' "$WEEK"
printf 'Examined %d merged PRs:\n' "$examined"
printf -- '- Clean: %d\n' "$clean"
printf -- '- Under-tagged: %d\n' "$under"
printf -- '- Over-tagged: %d\n\n' "$over"
if [[ -n "$rows" ]]; then
	printf '| PR | Title | Author | Derived | Delta | Entry |\n'
	printf '|----|-------|--------|---------|-------|-------|\n'
	printf '%s\n' "${rows%$'\n'}"
	printf '\n**Legend:** `+` author had it, map missed it (add at Entry)  -  `-` map produced it, author did not (review)  -  `(review)` a leaf intentionally narrowed it away\n'
fi

# --- machine-readable counts for the workflow (Slack) ---
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	{
		echo "examined=$examined"
		echo "clean=$clean"
		echo "under=$under"
		echo "over=$over"
		echo "week=$WEEK"
	} >> "$GITHUB_OUTPUT"
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/audit-e2e-tags.sh`

- [ ] **Step 3: Smoke test against a small live window**

Run: `bash scripts/audit-e2e-tags.sh 20`
Expected: a Markdown report - `## :label: Test Tag Audit - recent 20 PRs`, an `Examined 20 merged PRs:` summary with `Clean/Under-tagged/Over-tagged` bullets, and (if any divergences) a 6-column table whose `PR` cells are `[#NNNNN](https://github.com/posit-dev/positron/pull/NNNNN)` links, plus the legend. Confirm no `+` rows have an empty `Entry` (gap-suppression works) and no `command not found` errors.

- [ ] **Step 4: Verify GITHUB_OUTPUT counts**

Run: `GITHUB_OUTPUT=/tmp/out.$$ bash scripts/audit-e2e-tags.sh 20 >/dev/null && cat /tmp/out.$$ && rm -f /tmp/out.$$`
Expected: five lines - `examined=20`, `clean=<n>`, `under=<n>`, `over=<n>`, `week=recent 20 PRs`.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit-e2e-tags.sh
git commit -m "feat: add e2e tag audit report generator"
```

---

### Task 5: Weekly workflow `e2e-tag-audit.yml`

**Files:**
- Create: `.github/workflows/e2e-tag-audit.yml`
- (Validated by manual `workflow_dispatch`, not unit-tested.)

**Interfaces:**
- Consumes: `scripts/audit-e2e-tags.sh` (`--since` mode), its `GITHUB_OUTPUT` counts, secret `SLACK_TOKEN_TEST_STATUS`.
- Produces: a job-summary report every run + a Slack message to `#positron-dev` every run; a failure notice to `#positron-test-results` on workflow failure.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/e2e-tag-audit.yml`:

```yaml
name: E2E Tag Audit

on:
  schedule:
    - cron: '0 12 * * 1'   # Mondays ~06:00 CT (12:00 UTC; DST drift accepted)
  workflow_dispatch:
    inputs:
      since:
        description: 'ISO date (YYYY-MM-DD); default = 7 days ago'
        required: false
      dry_run:
        description: 'Skip the Slack post (write the job summary only)'
        type: boolean
        default: false

permissions:
  contents: read
  pull-requests: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run audit
        id: audit
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          SINCE="${{ github.event.inputs.since }}"
          if [ -z "$SINCE" ]; then SINCE="$(date -u -d '7 days ago' +%Y-%m-%d)"; fi
          bash scripts/audit-e2e-tags.sh --since "$SINCE" | tee "$GITHUB_STEP_SUMMARY"

      - name: Post to Slack
        if: ${{ github.event_name == 'schedule' || github.event.inputs.dry_run != 'true' }}
        env:
          SLACK_TOKEN: ${{ secrets.SLACK_TOKEN_TEST_STATUS }}
        run: |
          RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
          TEXT="$(printf ':label: *<%s|Test Tag Audit>* - %s\nExamined %s merged PRs:\n- Clean: %s\n- Under-tagged: %s\n- Over-tagged: %s' \
            "$RUN_URL" \
            "${{ steps.audit.outputs.week }}" \
            "${{ steps.audit.outputs.examined }}" \
            "${{ steps.audit.outputs.clean }}" \
            "${{ steps.audit.outputs.under }}" \
            "${{ steps.audit.outputs.over }}")"
          jq -n --arg channel "#positron-dev" --arg text "$TEXT" \
            '{channel: $channel, text: $text}' \
            | curl -sS -X POST https://slack.com/api/chat.postMessage \
                -H "Authorization: Bearer $SLACK_TOKEN" \
                -H 'Content-type: application/json; charset=utf-8' \
                --data @-

  slack-notify:
    needs: audit
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Notify Slack on failure
        uses: midleman/slack-workflow-status@v3.1.3
        with:
          slack_token: ${{ secrets.SLACK_TOKEN_TEST_STATUS }}
          slack_channel: "#positron-test-results"
          notify_on: "failure"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/e2e-tag-audit.yml
git commit -m "feat: weekly e2e tag audit workflow (job summary + Slack)"
```

- [ ] **Step 3: Push the branch**

```bash
git push -u origin mi/e2e-tag-audit
```

- [ ] **Step 4: Validate the workflow from the branch (dry run, no Slack)**

Run: `gh workflow run e2e-tag-audit.yml --ref mi/e2e-tag-audit -f dry_run=true`
Then watch: `gh run list --workflow e2e-tag-audit.yml --limit 1` and open the run.
Expected: the run succeeds; its **Summary** tab shows the `Test Tag Audit` report (header, count bullets, table with linked PRs, legend); the "Post to Slack" step is **skipped** (dry run).

- [ ] **Step 5: Validate the Slack post**

Run: `gh workflow run e2e-tag-audit.yml --ref mi/e2e-tag-audit`
Expected: `#positron-dev` receives a message whose title `Test Tag Audit` links to the run, followed by `Examined N merged PRs:` and the `Clean/Under-tagged/Over-tagged` bullets. (If you want to avoid posting to `#positron-dev` during validation, temporarily point the channel at a test channel in the workflow, then revert.)

- [ ] **Step 6: Enable the schedule / open PR**

The `schedule` trigger only fires from the default branch, so it activates once this merges. Open the PR:

```bash
gh pr create --base main --head mi/e2e-tag-audit \
  --title "ci: weekly e2e tag audit (map drift feedback loop)" \
  --body "Weekly read-only job comparing author-tagged vs auto-derived e2e feature tags across merged PRs; posts a divergence report to the job summary and #positron-dev. Spec: docs/superpowers/specs/2026-07-01-e2e-tag-audit-feedback-loop-design.md"
```

---

## Self-Review

**1. Spec coverage:**
- Shared primitives (`csv_minus`, `longest_map_prefix`, ancestor-explained) -> Tasks 1-3. ✓
- Generator reusing `derive_map_tags`/`is_derivable_source`, gap-suppression on non-source PRs, no diffs, `Entry` pointer, canonical header, summary bullets (Clean/Under-tagged/Over-tagged), 6-column table with linked PRs, legend, `--since`/`[N] [SKIP]` -> Task 4. ✓
- Workflow: cron + dispatch, job summary, Slack to `#positron-dev` via `chat.postMessage` (title linked, post every week), failure notice, permissions `contents/pull-requests: read` -> Task 5. ✓
- Read-only, deterministic, no LLM -> enforced by construction (only `gh` reads; no write calls anywhere). ✓
- Testing proportional to complexity: pure primitives unit-tested; glue (script, workflow) smoke-tested via manual runs -> matches the spec's stated testing approach. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands. ✓

**3. Type/name consistency:** `csv_minus`, `longest_map_prefix`, `tag_ancestor_explained` are defined in Tasks 1-3 and consumed with the same signatures in Task 4; workflow reads exactly the `GITHUB_OUTPUT` keys (`examined/clean/under/over/week`) Task 4 writes. ✓
