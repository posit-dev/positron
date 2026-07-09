# E2E Test-Change Auto-Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a PR touches `test/e2e/tests/**/*.test.ts` files, automatically add the smallest additional tag set needed to guarantee those touched tests run, folded into the existing `--grep`-based PR tag-derivation pipeline.

**Architecture:** A new Node script (`scripts/derive-test-change-tags.mjs`) runs `npx playwright test --list --project e2e-electron --reporter=json` to get every test's file, declared tags, and skip status; for touched files not already covered by the PR's other selected tags, it solves an exact (small-scale) minimal-cost tag-set-cover and prints the result for `scripts/pr-tags-parse.sh` to union additively into `TAGS`, exactly like every other derivation source today.

**Tech Stack:** Bash (existing `scripts/pr-tags-parse.sh` / `scripts/lib/pr-tags-lib.sh` orchestration), Node.js (new script, matching the `apply-test-tag-map-fixes.mjs` precedent), GitHub Actions (`test-pull-request.yml`), Playwright CLI.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-09-e2e-test-change-auto-tagging-design.md` — every task below implements a specific section of it.
- Tabs for indentation in all TypeScript/JavaScript/Node files (repo convention).
- Bash scripts use tabs too, matching `scripts/lib/pr-tags-lib.sh` / `scripts/pr-tags-parse.sh` style.
- No new runtime npm dependency beyond `@playwright/test` (already a root devDependency, pinned `^1.58.2` in `package.json`) — the new Node script uses only `node:fs`, `node:child_process` from the standard library.
- `@:no-auto-tags` must suppress **all** derivation sources uniformly after this change (src-path-map, the new test-change derivation, and the existing WIN/WEB scan) — a deliberate, accepted-risk behavior change to the WIN/WEB scan specifically (see design doc §3).
- Detection scope is `test/e2e/tests/**/*.test.ts` only; granularity is whole-file (every non-skipped test in a touched file counts, individually, for the per-test coverage check).
- Never invent a tag: only tags already declared on a test's own `test.describe`/`test`/`test.fixme`/`test.skip` call are ever candidates.

---

### Task 1: Give the `pr-tags` CI job the ability to run `playwright test --list`

**Files:**
- Modify: `.github/workflows/test-pull-request.yml:36-46` (the `pr-tags` job's `steps:`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a `pr-tags` job environment where `npx playwright test --list --project e2e-electron --reporter=json` succeeds from the repo root. Later tasks' `derive-test-change-tags.mjs` (Task 2) depends on this working in CI (it already works in any dev machine with `node_modules` installed; this task makes it work on a fresh CI checkout).

Today the job is dependency-free: `actions/checkout` straight into bash scripts using only `gh`/`jq`. `npx playwright test --list` needs two things that don't exist in a fresh checkout: (1) `@playwright/test` resolvable from repo root (it's a root `devDependency`, not something `npx` can safely auto-fetch ad hoc), and (2) `test/e2e`'s own runtime dependencies installed, because `test/e2e/tests/_test.setup.ts` (imported by every test file) pulls in `test/e2e`'s real fixture chain (`canvas`, `resemblejs`, `@aws-sdk/client-s3`, etc. from `test/e2e/package.json`) at module-load time, which `--list` must succeed at importing just to discover tests. Browser binaries are **not** needed (`--list` never launches a browser), so this deliberately skips the heavier `setup-e2e-test-dependencies` composite action (which also runs `playwright install`, `playwright install-deps`, and a `tsc` compile step none of which `--list` requires).

- [ ] **Step 1: Add a Node setup step and a scoped, browser-free install step to the `pr-tags` job**

Edit `.github/workflows/test-pull-request.yml`. Find:

```yaml
    steps:
      - uses: actions/checkout@v7
      # Guardrail for the tag-derivation scripts; fail fast before relying on them below.
      - name: Unit test the tag-derivation helpers
        run: bash scripts/test/pr-tags-lib-test.sh
```

Replace with:

```yaml
    steps:
      - uses: actions/checkout@v7
      # Needed for derive-test-change-tags.mjs's `playwright test --list` call
      # below (Task 2). Pinned via .nvmrc rather than relying on whatever
      # ubuntu-latest ships with.
      - name: Set up Node
        uses: actions/setup-node@v6
        with:
          node-version-file: ".nvmrc"
      # Scoped, browser-free install: just enough for `playwright test --list`
      # to import every test file and discover its tags. No browser binaries,
      # no install-deps, no tsc compile -- none of those are needed to list
      # tests. See the design doc's "pr-tags job needs a new install step"
      # addendum for why both installs are necessary.
      - name: Install minimal Playwright + e2e test deps for test listing
        env:
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
        run: |
          PW_VERSION=$(node -pe "require('./package.json').devDependencies['@playwright/test']")
          npm install --no-save "@playwright/test@${PW_VERSION}"
          npm --prefix test/e2e ci
      # Guardrail for the tag-derivation scripts; fail fast before relying on them below.
      - name: Unit test the tag-derivation helpers
        run: bash scripts/test/pr-tags-lib-test.sh
```

- [ ] **Step 2: Verify locally that the resulting command works from a clean-ish state**

This step can't be a unit test (it's CI infrastructure), so verify by simulating the install in a scratch directory:

Run:
```bash
cd /tmp && rm -rf pw-verify && mkdir pw-verify && cd pw-verify
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save @playwright/test@^1.58.2
node -e "console.log(require('@playwright/test/package.json').version)"
```
Expected: prints an installed version like `1.58.x`, no browser download output, exits 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test-pull-request.yml
git commit -m "ci: give pr-tags job a scoped playwright install for test listing"
```

Real end-to-end verification (does the full `playwright test --list --project e2e-electron --reporter=json` command succeed in the actual `pr-tags` job) happens when this branch's own PR runs CI — flag this explicitly to a reviewer rather than treating Step 2 alone as sufficient proof.

---

### Task 2: `scripts/derive-test-change-tags.mjs` — core algorithm

**Files:**
- Create: `scripts/derive-test-change-tags.mjs`
- Test: `scripts/test/pr-tags-lib-test.sh` (new section appended, following the existing `apply-test-tag-map-fixes.mjs` direct-invocation-test convention at line 510)

**Interfaces:**
- Consumes: nothing from other tasks (standalone; Task 1 makes its real `playwright test --list` call work in CI, but this task's own tests use the `--list-json` override, so they don't depend on Task 1 at all).
- Produces: a CLI contract Task 4 depends on —
  - argv: `--changed-files <path>` (required; path to a newline-delimited file of repo-relative changed paths), `--selected-tags <csv>` (optional, default empty; comma-separated tags already selected), `--list-json <path>` (optional, test-only override; when given, reads this file instead of invoking `playwright test --list`).
  - stdout: newline-separated new tag names to additively union in (empty output is valid).
  - stderr: warnings only (e.g. untagged touched tests) — never mixed into stdout.
  - exit code: `0` on success (including "nothing to add"), non-zero if `playwright test --list` itself fails or `--changed-files` is missing/unreadable.

- [ ] **Step 1: Write the fixture JSON and failing tests**

Append to `scripts/test/pr-tags-lib-test.sh`, right before the final `[[ $fail -eq 0 ]] && echo "ALL PASS"` / `exit $fail` lines:

```bash
# --- derive-test-change-tags.mjs ---
DERIVE_SCRIPT="$HERE/../derive-test-change-tags.mjs"
DERIVE_DIR="$(mktemp -d)"

# A trimmed-down stand-in for `playwright test --list --project e2e-electron
# --reporter=json`'s shape: top-level suites keyed by file, nested describe
# suites (each ALSO carrying its own "file" field, redundant with the parent
# but present in every real level -- verified against a real capture; the
# script's collectSpecs relies on it, so a fixture missing it at the nested
# level would silently produce zero matches), leaf specs with `tags` (each
# WITH a leading colon, e.g. ":console", matching real playwright output; the
# script re-adds "@" via `@${t}` so it must already be there) and a
# `tests[].expectedStatus` field ("skipped" for anything under a static
# .skip/.fixme).
#
# console-other.test.ts / editor-other.test.ts exist purely to make
# @:console and @:editor's repo-wide costs (7 each) clearly higher than
# @:viewer's and @:plots's (2 each) -- without that asymmetry, @:console vs
# @:viewer (and @:editor vs @:plots) would tie on cost, and which one wins
# would depend on brute-force mask iteration order rather than demonstrating
# real minimization.
cat > "$DERIVE_DIR/list.json" <<'JSON'
{
  "suites": [
    {
      "file": "tests/viewer/viewer.test.ts",
      "suites": [
        {
          "file": "tests/viewer/viewer.test.ts",
          "specs": [
            { "title": "Python - opens", "tags": [":viewer", ":console"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "R - opens", "tags": [":viewer", ":console", ":web"], "tests": [{ "expectedStatus": "passed" }] }
          ]
        }
      ]
    },
    {
      "file": "tests/plots/plots.test.ts",
      "suites": [
        {
          "file": "tests/plots/plots.test.ts",
          "specs": [
            { "title": "Python plot", "tags": [":plots", ":editor"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "R plot", "tags": [":plots", ":editor", ":ark"], "tests": [{ "expectedStatus": "passed" }] }
          ]
        }
      ]
    },
    {
      "file": "tests/console/console-untagged.test.ts",
      "suites": [
        {
          "file": "tests/console/console-untagged.test.ts",
          "specs": [
            { "title": "no tags here", "tags": [], "tests": [{ "expectedStatus": "passed" }] }
          ]
        }
      ]
    },
    {
      "file": "tests/console/console-skipped.test.ts",
      "suites": [
        {
          "file": "tests/console/console-skipped.test.ts",
          "specs": [
            { "title": "statically skipped", "tags": [":console"], "tests": [{ "expectedStatus": "skipped" }] }
          ]
        }
      ]
    },
    {
      "file": "tests/console/console-other.test.ts",
      "suites": [
        {
          "file": "tests/console/console-other.test.ts",
          "specs": [
            { "title": "other console test 0", "tags": [":console"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other console test 1", "tags": [":console"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other console test 2", "tags": [":console"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other console test 3", "tags": [":console"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other console test 4", "tags": [":console"], "tests": [{ "expectedStatus": "passed" }] }
          ]
        }
      ]
    },
    {
      "file": "tests/editor/editor-other.test.ts",
      "suites": [
        {
          "file": "tests/editor/editor-other.test.ts",
          "specs": [
            { "title": "other editor test 0", "tags": [":editor"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other editor test 1", "tags": [":editor"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other editor test 2", "tags": [":editor"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other editor test 3", "tags": [":editor"], "tests": [{ "expectedStatus": "passed" }] },
            { "title": "other editor test 4", "tags": [":editor"], "tests": [{ "expectedStatus": "passed" }] }
          ]
        }
      ]
    }
  ]
}
JSON

changed_file() { printf '%s\n' "$1" > "$DERIVE_DIR/changed.txt"; }

changed_file "test/e2e/tests/viewer/viewer.test.ts"
OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed.txt" --selected-tags "" --list-json "$DERIVE_DIR/list.json")"
assert_eq "touched file, nothing selected yet: picks the cheaper of its own tags" "@:viewer" "$OUT"

OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed.txt" --selected-tags "@:console" --list-json "$DERIVE_DIR/list.json")"
assert_eq "touched file already covered by an existing tag: nothing to add" "" "$OUT"

printf '%s\n%s\n' "test/e2e/tests/viewer/viewer.test.ts" "test/e2e/tests/plots/plots.test.ts" > "$DERIVE_DIR/changed-two.txt"
OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed-two.txt" --selected-tags "" --list-json "$DERIVE_DIR/list.json")"
assert_eq "two touched files, no shared tag: picks one cheap tag per file" "$(printf '@:plots\n@:viewer')" "$OUT"

changed_file "test/e2e/tests/console/console-untagged.test.ts"
WARN_OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed.txt" --selected-tags "" --list-json "$DERIVE_DIR/list.json" 2>&1 1>/dev/null)"
if printf '%s' "$WARN_OUT" | grep -qF "no declared tags"; then
	echo "PASS: untagged touched test warns on stderr"
else
	echo "FAIL: untagged touched test should warn on stderr"; fail=1
fi
STDOUT_ONLY="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed.txt" --selected-tags "" --list-json "$DERIVE_DIR/list.json" 2>/dev/null)"
assert_eq "untagged touched test: nothing added to stdout" "" "$STDOUT_ONLY"

changed_file "test/e2e/tests/console/console-skipped.test.ts"
OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed.txt" --selected-tags "" --list-json "$DERIVE_DIR/list.json")"
assert_eq "statically-skipped touched test: nothing to add" "" "$OUT"

changed_file "test/e2e/tests/nonexistent/deleted.test.ts"
OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/changed.txt" --selected-tags "" --list-json "$DERIVE_DIR/list.json")"
assert_eq "touched file not in the listing (e.g. deleted): no-op" "" "$OUT"

: > "$DERIVE_DIR/empty-changed.txt"
OUT="$(node "$DERIVE_SCRIPT" --changed-files "$DERIVE_DIR/empty-changed.txt" --selected-tags "@:critical" --list-json "$DERIVE_DIR/list.json")"
assert_eq "no changed e2e test files: no-op" "" "$OUT"

if node "$DERIVE_SCRIPT" --selected-tags "" --list-json "$DERIVE_DIR/list.json" >/dev/null 2>&1; then
	echo "FAIL: script should require --changed-files"; fail=1
else
	echo "PASS: script fails loudly when --changed-files is missing"
fi

rm -rf "$DERIVE_DIR"
```

- [ ] **Step 2: Run the tests to verify they fail (script doesn't exist yet)**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: FAIL — `node: cannot find module '.../derive-test-change-tags.mjs'` (or similar), non-zero exit.

- [ ] **Step 3: Write `scripts/derive-test-change-tags.mjs`**

```javascript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Derives the minimal additional e2e tag(s) needed to guarantee touched/added
// e2e test files actually run, without over-selecting sibling suites that
// happen to share a broader tag. See
// docs/superpowers/specs/2026-07-09-e2e-test-change-auto-tagging-design.md.
//
// Usage:
//   node scripts/derive-test-change-tags.mjs --changed-files <path> [--selected-tags <csv>] [--list-json <path>]
//
//   changed-files: path to a newline-delimited file of repo-relative changed paths
//   selected-tags: comma-separated tags already selected by earlier derivation
//     steps (author + src-path-map + @:critical + @:ark). Default: empty.
//   list-json: test-only override. When given, reads this file instead of
//     invoking `playwright test --list --project e2e-electron --reporter=json`.
//     Its shape must match that command's real JSON output.
//
// Prints newline-separated new tag(s) to stdout (empty output = nothing
// needed). Warnings (e.g. a touched test with no declared tags) go to stderr
// only, never mixed into stdout.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const TOUCHED_FILE_RE = /^test\/e2e\/tests\/.*\.test\.ts$/;
// Above this many candidate tags, fall back to a greedy approximation instead
// of exact brute-force search (2^n subsets). Not expected to trigger in
// practice -- a single PR's touched-file set is small -- but bounds the
// algorithm's worst case rather than leaving it unbounded.
const CANDIDATE_CAP = 20;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i++; }
	}
	return args;
}

function fail(message) {
	console.error(`derive-test-change-tags: ${message}`);
	process.exit(1);
}

// Walks a playwright --list --reporter=json tree, collecting every non-skipped
// leaf spec as { file, title, tags: Set<string> }. `file` is repo-relative
// (playwright reports it relative to testDir, which is ./test/e2e -- prefix
// restores the repo-root-relative form used elsewhere in this pipeline).
// Tags are normalized back to "@:xxx" form (playwright's JSON omits the
// leading "@").
function collectSpecs(suite, out) {
	for (const spec of suite.specs ?? []) {
		const skipped = (spec.tests ?? []).some(t => t.expectedStatus === 'skipped');
		if (skipped) { continue; }
		out.push({
			file: `test/e2e/${suite.file}`,
			title: spec.title,
			tags: new Set((spec.tags ?? []).map(t => `@${t}`)),
		});
	}
	for (const child of suite.suites ?? []) { collectSpecs(child, out); }
}

function listAllSpecs(listJsonPath) {
	let raw;
	if (listJsonPath) {
		raw = readFileSync(listJsonPath, 'utf8');
	} else {
		try {
			raw = execFileSync(
				'npx',
				['playwright', 'test', '--list', '--project', 'e2e-electron', '--reporter=json'],
				{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
			);
		} catch (e) {
			fail(`playwright test --list failed: ${e.message}`);
		}
	}
	const json = JSON.parse(raw);
	const specs = [];
	for (const suite of json.suites ?? []) { collectSpecs(suite, specs); }
	return specs;
}

// True set-union cost: how many specs, not already in `alreadySelectedIds`,
// would `tagSubset` additionally select. Not a sum of per-tag counts -- two
// candidate tags can both match the same spec, and summing would double-count it.
function additionalCost(tagSubset, idsByTag, alreadySelectedIds) {
	const union = new Set();
	for (const tag of tagSubset) {
		for (const id of idsByTag.get(tag) ?? []) { union.add(id); }
	}
	let cost = 0;
	for (const id of union) { if (!alreadySelectedIds.has(id)) { cost++; } }
	return cost;
}

function covers(tagSubset, touchedUncovered) {
	const chosen = new Set(tagSubset);
	return touchedUncovered.every(s => [...s.tags].some(t => chosen.has(t)));
}

function bruteForceMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds) {
	let bestSet = null;
	let bestCost = Infinity;
	const n = candidates.length;
	for (let mask = 1; mask < (1 << n); mask++) {
		const subset = candidates.filter((_, i) => mask & (1 << i));
		if (!covers(subset, touchedUncovered)) { continue; }
		const cost = additionalCost(subset, idsByTag, alreadySelectedIds);
		if (cost < bestCost || (cost === bestCost && (!bestSet || subset.length < bestSet.length))) {
			bestCost = cost;
			bestSet = subset;
		}
	}
	return (bestSet ?? []).sort();
}

// Greedy weighted set-cover fallback for pathologically large candidate sets:
// repeatedly pick the tag that covers the most still-uncovered touched tests
// per unit of marginal additional cost, until everything is covered.
function greedyMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds) {
	let remaining = [...touchedUncovered];
	const chosen = [];
	while (remaining.length > 0) {
		let bestTag = null;
		let bestScore = -1;
		const baseCost = additionalCost(chosen, idsByTag, alreadySelectedIds);
		for (const tag of candidates) {
			if (chosen.includes(tag)) { continue; }
			const newlyCovered = remaining.filter(s => s.tags.has(tag)).length;
			if (newlyCovered === 0) { continue; }
			const marginalCost = additionalCost([...chosen, tag], idsByTag, alreadySelectedIds) - baseCost;
			const score = newlyCovered / Math.max(1, marginalCost);
			if (score > bestScore) { bestScore = score; bestTag = tag; }
		}
		if (!bestTag) { break; } // shouldn't happen: candidates is exhaustive over `remaining`'s own tags
		chosen.push(bestTag);
		remaining = remaining.filter(s => !s.tags.has(bestTag));
	}
	return chosen.sort();
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args['changed-files']) { fail('--changed-files is required'); }

	const changedFiles = readFileSync(args['changed-files'], 'utf8')
		.split('\n').map(l => l.trim()).filter(Boolean);
	const touchedFiles = [...new Set(changedFiles.filter(f => TOUCHED_FILE_RE.test(f)))];
	if (touchedFiles.length === 0) { return; }

	const selected = new Set((args['selected-tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean));
	const allSpecs = listAllSpecs(args['list-json']);

	const specId = (s, i) => `${s.file}::${i}`;
	const touchedUncovered = [];
	for (const file of touchedFiles) {
		const specsInFile = allSpecs.filter(s => s.file === file);
		for (const spec of specsInFile) {
			if (spec.tags.size === 0) {
				console.error(`derive-test-change-tags: ${file} has no declared tags for "${spec.title}" -- add tags or tag the PR body manually.`);
				continue;
			}
			const covered = [...spec.tags].some(t => selected.has(t));
			if (!covered) { touchedUncovered.push(spec); }
		}
	}
	if (touchedUncovered.length === 0) { return; }

	const candidates = [...new Set(touchedUncovered.flatMap(s => [...s.tags]))].sort();

	const idsByTag = new Map();
	for (const tag of candidates) {
		const ids = new Set();
		allSpecs.forEach((s, i) => { if (s.tags.has(tag)) { ids.add(specId(s, i)); } });
		idsByTag.set(tag, ids);
	}
	const alreadySelectedIds = new Set();
	allSpecs.forEach((s, i) => { if ([...s.tags].some(t => selected.has(t))) { alreadySelectedIds.add(specId(s, i)); } });

	const best = candidates.length <= CANDIDATE_CAP
		? bruteForceMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds)
		: greedyMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds);

	for (const tag of best) { console.log(tag); }
}

main();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: every `PASS:` line for the new `derive-test-change-tags.mjs` section, `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/derive-test-change-tags.mjs scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add derive-test-change-tags.mjs for minimal-cost e2e test-change tagging"
```

---

### Task 3: New `test-changed` provenance code in `scripts/lib/pr-tags-lib.sh`

**Files:**
- Modify: `scripts/lib/pr-tags-lib.sh` (`build_tag_reasons`, `render_why_these_tags`)
- Test: `scripts/test/pr-tags-lib-test.sh` (existing `build_tag_reasons` / `render_why_these_tags` sections)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `build_tag_reasons` gains a 7th parameter (`test_change_csv`); Task 4 passes the comma-joined output of Task 2's script as this argument.

- [ ] **Step 1: Write the failing tests**

In `scripts/test/pr-tags-lib-test.sh`, find the existing `build_tag_reasons` block (starting `# --- build_tag_reasons ---`) and add these assertions immediately after the existing `"reasons: unattributed tag falls back to auto"` case, before the `# --- render_why_these_tags ---` comment:

```bash
assert_eq "reasons: test-change-derived tag is test-changed" "@:critical|required,@:viewer|test-changed" \
	"$(build_tag_reasons "@:critical,@:viewer" "" "" "false" "false" "false" "@:viewer")"
# A tag that's both map-derived AND test-change-derived: files (the earlier
# source) wins, since it was already selected before the test-change step ran.
assert_eq "reasons: map+test-change overlap prefers files" "@:critical|required,@:console|files" \
	"$(build_tag_reasons "@:critical,@:console" "" "@:console" "false" "false" "false" "@:console")"
```

Then, in the `# --- render_why_these_tags ---` block, add after the existing WEB_OUT assertion:

```bash
TESTCHANGE_OUT="$(render_why_these_tags "@:critical|required,@:viewer|test-changed")"
if printf '%s' "$TESTCHANGE_OUT" | grep -qF '| `@:viewer` | Touched test file |'; then
	echo "PASS: render labels the test-changed arm"
else
	echo "FAIL: render should label @:viewer as Touched test file"; fail=1
fi
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: FAIL on both new assertions — `build_tag_reasons` currently only accepts 6 arguments (the 7th is silently ignored / falls back to `auto` since nothing reads it yet), and `render_why_these_tags` has no `test-changed` case so it falls through to the generic `Auto-selected` label.

- [ ] **Step 3: Update `build_tag_reasons` and `render_why_these_tags`**

In `scripts/lib/pr-tags-lib.sh`, replace the `build_tag_reasons` function:

```bash
# build_tag_reasons <final_csv> <author_csv> <map_csv> <ark> <added_win> <added_web> [<test_change_csv>]
# Assigns each tag in <final_csv> (comma-separated, order-stable) a single source
# code by precedence: required -> body -> files -> ark -> test-win -> test-web ->
# test-changed -> auto. Booleans are the strings "true"/"false". Echoes
# comma-separated "<tag>|<code>" pairs in <final_csv> order; empty final list
# echoes nothing. <test_change_csv> defaults to empty (older 6-arg callers keep
# working; those tags just fall through to "auto"). Pure: presentation of an
# already-decided tag set, no gh / $GITHUB_OUTPUT.
build_tag_reasons() {
	local final="$1" author="$2" map="$3" ark="$4" added_win="$5" added_web="$6" test_change="${7:-}"
	local tag code author_nl map_nl test_change_nl
	local -a out=()
	author_nl="${author//,/$'\n'}"
	map_nl="${map//,/$'\n'}"
	test_change_nl="${test_change//,/$'\n'}"
	while IFS= read -r tag; do
		[[ -z "$tag" ]] && continue
		if [[ "$tag" == "@:critical" ]]; then
			code="required"
		elif printf '%s\n' "$author_nl" | grep -qxF "$tag"; then
			code="body"
		elif printf '%s\n' "$map_nl" | grep -qxF "$tag"; then
			code="files"
		elif [[ "$tag" == "@:ark" && "$ark" == "true" ]]; then
			code="ark"
		elif [[ "$tag" == "@:win" && "$added_win" == "true" ]]; then
			code="test-win"
		elif [[ "$tag" == "@:web" && "$added_web" == "true" ]]; then
			code="test-web"
		elif printf '%s\n' "$test_change_nl" | grep -qxF "$tag"; then
			code="test-changed"
		else
			code="auto"
		fi
		out+=("$tag|$code")
	done < <(printf '%s\n' "${final//,/$'\n'}")
	[[ ${#out[@]} -eq 0 ]] && return 0
	printf '%s\n' "${out[@]}" | paste -sd, -
}
```

In `render_why_these_tags`, find the `case "$code" in` block and add a new arm:

```bash
			required) label="Always runs (required)" ;;
			body)     label="PR description" ;;
			files)    label="Changed files" ;;
			ark)      label="Ark submodule bump" ;;
			test-win) label="New test (tags.WIN)" ;;
			test-web) label="New test (tags.WEB)" ;;
			test-changed) label="Touched test file" ;;
			*)        label="Auto-selected" ;;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pr-tags-lib.sh scripts/test/pr-tags-lib-test.sh
git commit -m "feat: add test-changed provenance code for e2e test-change auto-tagging"
```

---

### Task 4: Wire it all into `scripts/pr-tags-parse.sh` and update docs

**Files:**
- Modify: `scripts/pr-tags-parse.sh:174-218` (restructure the `@:no-auto-tags` gate, invoke Task 2's script, pass the new arg to `build_tag_reasons`)
- Modify: `test/e2e/README.md` (the "Automatic Tags (from changed files)" section)

**Interfaces:**
- Consumes: `scripts/derive-test-change-tags.mjs`'s CLI contract (Task 2); `build_tag_reasons`'s new 7th parameter (Task 3).
- Produces: the complete end-to-end feature. Nothing downstream depends on this task.

Today, the map-derived-tags block and the WIN/WEB scan are two separate, differently-gated pieces: map-derivation is skipped by `@:no-auto-tags`, but the WIN/WEB scan runs unconditionally (comment: "Runs regardless of @:no-auto-tags"). This task merges them into one `@:no-auto-tags`-gated block, matching the design doc's §3 decision that the opt-out should suppress everything uniformly, and adds the new test-change derivation as a third step inside that same block, positioned after map-derivation (so it knows what's already selected) and before the WIN/WEB scan (order between those two doesn't matter, since WIN/WEB additions don't affect what test-change derivation needs to cover).

- [ ] **Step 1: Restructure the gate and add the new derivation step**

In `scripts/pr-tags-parse.sh`, find this block (originally lines 178–218):

```bash
	# Auto-inject feature tags derived from the PR's changed SOURCE files, unless
	# the author opted out with @:no-auto-tags. Additive only -- never removes
	# tags the author specified. Derivation is scoped to the source/extension
	# PATH map: it targets the population that under-tags (devs fixing code who
	# may not know which e2e suite covers it). Test-file changes are NOT
	# auto-tagged -- those are almost always authored by QA, who tag deliberately,
	# and deriving every feature tag off a multi-tagged test file over-selected
	# whole sibling suites for no coverage gain on the impacted test.
	if echo "$PR_BODY" | grep -q "@:no-auto-tags"; then
		echo "Found @:no-auto-tags. Skipping derived tagging."
	elif [[ -n "$CHANGED_FILES" && -f "$MAP_FILE" ]]; then
		MAP_TAGS="$(derive_map_tags "$CHANGED_FILES" "$MAP_FILE")"
		if [[ -n "$MAP_TAGS" ]]; then
			echo "Derived tags from changed source files: $MAP_TAGS"
			TAGS="$(union_csv_tags "$TAGS" "$MAP_TAGS")"
		fi
	fi

	# Enable Windows/web jobs when a test genuinely adds tags.WIN/tags.WEB.
	# Runs regardless of @:no-auto-tags. Also add @:win/@:web to TAGS so the PR
	# comment explains why those jobs ran.
	# @json-encode each file's patch so embedded newlines don't merge files
	# together when read line by line -- see scan_added_platform_tags_across_files.
	declare -a TEST_FILE_PATCHES=()
	while IFS= read -r ENCODED_PATCH || [[ -n "$ENCODED_PATCH" ]]; do
		[[ -z "$ENCODED_PATCH" ]] && continue
		TEST_FILE_PATCHES+=("$(jq -r '.' <<< "$ENCODED_PATCH")")
	done < <(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate \
		--header "Authorization: token $GITHUB_TOKEN" \
		--jq '.[] | select(.filename | startswith("test/e2e/tests/")) | (.patch // "") | @json' || true)
	read -r ADDED_WIN ADDED_WEB <<< "$(scan_added_platform_tags_across_files "${TEST_FILE_PATCHES[@]}")"
	if [[ "$ADDED_WIN" == "true" ]]; then
		echo "Newly added e2e test carries tags.WIN. Enabling Windows tests."
		echo "win_tag_found=true" >> "$GITHUB_OUTPUT"
		TAGS="$(union_csv_tags "$TAGS" "@:win")"
	fi
	if [[ "$ADDED_WEB" == "true" ]]; then
		echo "Newly added e2e test carries tags.WEB. Enabling web tests."
		echo "web_tag_found=true" >> "$GITHUB_OUTPUT"
		TAGS="$(union_csv_tags "$TAGS" "@:web")"
	fi
```

Replace it with:

```bash
	# Auto-inject feature tags derived from the PR's changed files, unless the
	# author opted out with @:no-auto-tags -- which now suppresses every
	# derivation source uniformly (including the WIN/WEB scan below, which used
	# to run unconditionally): authors need one total escape hatch to override
	# auto-tagging at any time, not one exception carved out of it. Additive
	# only -- never removes tags the author specified.
	TEST_CHANGE_TAGS=""
	if echo "$PR_BODY" | grep -q "@:no-auto-tags"; then
		echo "Found @:no-auto-tags. Skipping derived tagging."
	else
		# Source/extension PATH changes -> feature tags. Scoped to the
		# source/extension PATH map: it targets the population that
		# under-tags (devs fixing code who may not know which e2e suite
		# covers it).
		if [[ -n "$CHANGED_FILES" && -f "$MAP_FILE" ]]; then
			MAP_TAGS="$(derive_map_tags "$CHANGED_FILES" "$MAP_FILE")"
			if [[ -n "$MAP_TAGS" ]]; then
				echo "Derived tags from changed source files: $MAP_TAGS"
				TAGS="$(union_csv_tags "$TAGS" "$MAP_TAGS")"
			fi
		fi

		# Touched/added e2e TEST files -> the minimal tag(s) needed to
		# guarantee they actually run, without over-selecting sibling
		# suites. See derive-test-change-tags.mjs and the design doc.
		DERIVE_TEST_CHANGE_SCRIPT="$SCRIPT_DIR/derive-test-change-tags.mjs"
		if [[ -n "$CHANGED_FILES" && -f "$DERIVE_TEST_CHANGE_SCRIPT" ]]; then
			CHANGED_FILES_FILE="$(mktemp)"
			printf '%s\n' "$CHANGED_FILES" > "$CHANGED_FILES_FILE"
			TEST_CHANGE_TAGS="$(node "$DERIVE_TEST_CHANGE_SCRIPT" \
				--changed-files "$CHANGED_FILES_FILE" \
				--selected-tags "$TAGS" | paste -sd, -)"
			rm -f "$CHANGED_FILES_FILE"
			if [[ -n "$TEST_CHANGE_TAGS" ]]; then
				echo "Derived tags from changed e2e test files: $TEST_CHANGE_TAGS"
				TAGS="$(union_csv_tags "$TAGS" "$TEST_CHANGE_TAGS")"
			fi
		fi

		# Enable Windows/web jobs when a test genuinely adds tags.WIN/tags.WEB.
		# Also add @:win/@:web to TAGS so the PR comment explains why those
		# jobs ran.
		# @json-encode each file's patch so embedded newlines don't merge
		# files together when read line by line -- see
		# scan_added_platform_tags_across_files.
		declare -a TEST_FILE_PATCHES=()
		while IFS= read -r ENCODED_PATCH || [[ -n "$ENCODED_PATCH" ]]; do
			[[ -z "$ENCODED_PATCH" ]] && continue
			TEST_FILE_PATCHES+=("$(jq -r '.' <<< "$ENCODED_PATCH")")
		done < <(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate \
			--header "Authorization: token $GITHUB_TOKEN" \
			--jq '.[] | select(.filename | startswith("test/e2e/tests/")) | (.patch // "") | @json' || true)
		read -r ADDED_WIN ADDED_WEB <<< "$(scan_added_platform_tags_across_files "${TEST_FILE_PATCHES[@]}")"
		if [[ "$ADDED_WIN" == "true" ]]; then
			echo "Newly added e2e test carries tags.WIN. Enabling Windows tests."
			echo "win_tag_found=true" >> "$GITHUB_OUTPUT"
			TAGS="$(union_csv_tags "$TAGS" "@:win")"
		fi
		if [[ "$ADDED_WEB" == "true" ]]; then
			echo "Newly added e2e test carries tags.WEB. Enabling web tests."
			echo "web_tag_found=true" >> "$GITHUB_OUTPUT"
			TAGS="$(union_csv_tags "$TAGS" "@:web")"
		fi
	fi
```

- [ ] **Step 2: Pass the new argument to `build_tag_reasons`**

Find (near the end of the script):

```bash
	TAG_REASONS="$(build_tag_reasons "$TAGS" "$AUTHOR_TAGS" "$MAP_TAGS" "$ARK_INJECTED" "$ADDED_WIN" "$ADDED_WEB")"
```

Replace with:

```bash
	TAG_REASONS="$(build_tag_reasons "$TAGS" "$AUTHOR_TAGS" "$MAP_TAGS" "$ARK_INJECTED" "$ADDED_WIN" "$ADDED_WEB" "$TEST_CHANGE_TAGS")"
```

- [ ] **Step 3: Run the full bash test suite to confirm nothing broke**

Run: `bash scripts/test/pr-tags-lib-test.sh`
Expected: `ALL PASS`, exit 0 (this suite tests the lib functions directly, not `pr-tags-parse.sh`'s orchestration, so it won't catch wiring mistakes in Step 1/2 -- Step 4 covers that).

- [ ] **Step 4: Manually sanity-check the wiring with a fixture-driven dry run**

`pr-tags-parse.sh` calls `gh api` and needs `GITHUB_REPOSITORY`/`GITHUB_PR_NUMBER`/`GITHUB_TOKEN`, so it can't run standalone without a real PR. Instead, verify the new block's shell syntax and variable flow directly:

Run: `bash -n scripts/pr-tags-parse.sh`
Expected: no output, exit 0 (syntax check only).

Then open a real (even draft/throwaway) PR that both edits a source file under a mapped directory and edits/adds an e2e test file with a distinct tag, and confirm in the `pr-tags` job log:
- "Derived tags from changed source files: ..." appears (existing behavior, unaffected)
- "Derived tags from changed e2e test files: ..." appears with the expected tag
- The PR's "E2E Tests" comment's "Why these tags?" table shows the new tag labeled "Touched test file"

- [ ] **Step 5: Update `test/e2e/README.md`**

In `test/e2e/README.md`, find the "Automatic Tags (from changed files)" section (currently starting at line 253) and add a new bullet after the existing "Source / extension changes" bullet:

```markdown
- **E2E test-file changes** map to the minimal tag(s) needed to guarantee the touched/added tests actually run, chosen to add as few additional sibling tests as possible -- see [`scripts/derive-test-change-tags.mjs`](https://github.com/posit-dev/positron/blob/main/scripts/derive-test-change-tags.mjs). A test file with no declared tags gets a warning in the job log instead of a guessed tag.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/pr-tags-parse.sh test/e2e/README.md
git commit -m "feat: wire e2e test-change tag derivation into pr-tags-parse.sh"
```

## Self-Review Notes

- **Spec coverage:** Detection (§1) → Task 2's `TOUCHED_FILE_RE` + whole-file handling. Selection algorithm (§2, including the `--project e2e-electron` and skip-exclusion fixes) → Task 2. Opt-out behavior change (§3) → Task 4 Step 1. Reporting (§4) → Task 3. Testing (§5) → Tasks 2–3's bash tests. The CI install addendum → Task 1.
- **Type/name consistency checked:** `derive-test-change-tags.mjs`'s CLI flags (`--changed-files`, `--selected-tags`, `--list-json`) are the same across Task 2's own tests and Task 4's invocation. `build_tag_reasons`'s new 7th parameter name (`test_change`) and the `test-changed` code string match between Task 3's implementation and Task 4's call site.
- **No placeholders:** every step has complete, concrete code (verified working against real repo data during design/plan research, not hand-waved pseudocode).
