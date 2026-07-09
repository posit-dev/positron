# E2E Test-Change Auto-Tagging — Design

## Problem

PR #14602 added automatic e2e test-tag derivation from **source** file changes: a
change under `src/vs/workbench/contrib/positronConsole/` auto-adds `@:console` to
the PR's tag set via `.github/workflows/test-tag-paths-map.json`. This works well
for developers who may not know which e2e suite covers the code they touched.

It deliberately excludes **e2e test file** changes (`is_derivable_source()` in
`scripts/lib/pr-tags-lib.sh` skips `*/test/*`, `*.test.*`). The one exception is a
narrow diff-hunk scan that detects a *newly added* `tags.WIN`/`tags.WEB` reference
and injects those two platform tags. There is no mechanism today that says "you
modified this e2e test, so let's make sure it actually runs" for any other tag.

The gap matters because e2e tests carry 1+ tags each, and `--grep` selection is a
straight OR-union of whatever tags are chosen — so naively adding *every* declared
tag on a touched test would over-select (pull in every sibling test sharing any of
those tags), while adding *no* tag risks the touched test silently not running at
all if the author forgets to hand-tag their PR body.

## Goal

When a PR adds or modifies an e2e test file, automatically add the smallest
additional set of tags needed to guarantee those touched tests run — without
inventing new tags, without expanding beyond the existing `--grep`-based CI
mechanism, and without duplicating or fighting the existing source-derived
tagging.

## Non-goals

- Line-level / per-`describe`-block diff precision. Whole-file granularity only
  (see Detection below) — deliberately, since intra-file test dependencies are
  common and precise hunk-to-test-block matching is real added complexity for
  uncertain benefit right now.
- Skipping comment/whitespace-only diffs. Flagged as a plausible v2 refinement,
  not in scope for this iteration.
- POM/fixture/page-object file changes. These don't carry tags and affect tests
  indirectly and unpredictably; a materially different (and harder) problem than
  "a `.test.ts` file with declared tags changed."
- Any mechanism that runs tests via explicit file/line positional CLI arguments.
  Investigated and rejected — see "Rejected approach" below.

## Rejected approach: direct test-selector execution

Playwright supports passing explicit `file:line` locators as CLI args instead of
`--grep`, which would give an exact (not tag-bounded) blast radius. This was the
first approach considered, since it sidesteps the whole "which tag is cheapest"
question.

It doesn't work as a single command, though: giving Playwright explicit file args
**restricts discovery to just those files** — a `--grep` alongside them filters
*within* that restricted set, it does not also union in tag-matches from the rest
of the repo (verified empirically: `playwright test viewer.test.ts --grep
"@:plots"` returns 0 tests, even though `@:plots` matches 45 tests repo-wide,
because `viewer.test.ts` itself has no `@:plots` tag).

Getting true union semantics in one command means resolving *both* the
tag-matched side and the touched-file side down to explicit locators, with no
`--grep` left in the final invocation. That's exactly the pattern that caused a
real production bug: e2e-test-insights' `run-shard` used to pass every discovered
spec as positional args, and on Windows that exceeded `cmd.exe`'s 8191-character
limit ([e2e-test-insights#174](https://github.com/posit-dev/e2e-test-insights/pull/174)).
Reusing that pattern here would reintroduce the same failure mode, requiring the
same kind of `coversFullSuite()`-style safeguard just to stay safe — at which
point it's simpler to just stay on the tag-only mechanism, which is already
short, already safe, and already proven in production.

## Design

### 1. Detection

- Scope: `test/e2e/tests/**/*.test.ts` changes only.
- Granularity: whole-file. Any changed line in a touched `.test.ts` file marks
  every `test.describe`/`test` block in that file as "touched" for this PR.

### 2. Tag selection algorithm

New Node script (matching the existing `apply-test-tag-map-fixes.mjs` precedent:
bash orchestrates, Node handles JSON-heavy logic), tentatively
`scripts/derive-test-change-tags.mjs`:

1. Run `npx playwright test --list --reporter=json` once. This is fast (~1.7s
   locally, no build daemon) and returns, for every test in the repo: its file,
   line, and full declared `tags` array. This doubles as the tag → test-count
   table (group by tag, count).
2. For each touched file (from the PR's changed-files list, filtered to
   `test/e2e/tests/**/*.test.ts`), look up the tags already declared on its
   `test.describe` blocks via the JSON from step 1. These declared tags are the
   **only** candidates ever considered — the script never invents a tag.
3. Skip a touched test if it's already covered by the PR's already-selected tag
   set at this point in the pipeline (author-typed tags + src-path-map-derived
   tags + `@:critical` + `@:ark` injection, i.e. whatever `pr-tags-parse.sh` has
   accumulated before this step runs).
4. For touched tests not yet covered, solve for the minimal-additional-blast-radius
   tag or small tag set: among the candidate tags gathered in step 2 (typically a
   small universe per PR — a handful of touched files, each with a handful of
   tags), find the choice that minimizes the total number of *additional* tests
   pulled in (using the counts from step 1), subject to covering every
   not-yet-covered touched test. Exact search is cheap at this scale.
5. Output the newly derived tag(s) for `pr-tags-parse.sh` to union into `TAGS` —
   additive only, same as every other derivation source today.

This step runs in `pr-tags-parse.sh` after the src-path-map derivation (so it
knows what's "already covered") and before the final dedupe/provenance step.

### 3. Opt-out — behavior change to existing system

`@:no-auto-tags` currently suppresses only the src-path-map derivation; the
WIN/WEB newly-added-tag scan **ignores** it (treated as an unconditional
correctness signal). This design changes that: `@:no-auto-tags` will suppress
**all** derivation sources uniformly — src-path-map (unchanged), the new
test-change derivation, and the existing WIN/WEB scan (changed). Rationale:
authors need one consistent, total escape hatch to override auto-tagging at any
time, e.g. when the tooling picks something wrong.

### 4. Reporting

New provenance code (e.g. `test-changed`) added to `build_tag_reasons` /
`render_why_these_tags` in `scripts/lib/pr-tags-lib.sh`, so the PR comment's "Why
these tags?" table explains a tag was added because a specific touched test file
needed it — following the exact pattern already used for `test-win`/`test-web`.

### 5. Testing

- Bash-level coverage in `scripts/test/pr-tags-lib-test.sh` (existing convention)
  for the new pure-bash glue (the "already covered" skip logic, the union into
  `TAGS`, the new provenance code).
- Direct invocation tests of the new Node script following the
  `apply-test-tag-map-fixes.mjs` precedent: fixture inputs (a small stand-in
  playwright `--list --reporter=json` payload + a changed-files list +
  already-selected tags), assert on stdout.

## Open items for the implementation plan

- Exact CLI contract for `scripts/derive-test-change-tags.mjs` (stdin/argv shape,
  stdout format) — left to the implementation plan.
- Whether the minimal-tag search is a small brute-force enumeration or a greedy
  weighted set-cover — both are cheap at this scale; pick based on which is
  simpler to implement and test correctly.
