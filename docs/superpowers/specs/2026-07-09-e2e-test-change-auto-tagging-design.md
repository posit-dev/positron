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

## Success criteria

- A PR that only touches e2e test files (no source, no author tags) never runs
  zero e2e tests as a result — the touched tests' own suite runs.
- The new `test-changed` provenance code (see Reporting below) makes this
  spot-checkable per-PR: the "Why these tags?" comment names the tag and the
  file that triggered it.

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
- Deleted test files are a no-op: a file that no longer exists won't appear in
  `playwright test --list` output, so it naturally contributes no tags. No
  special-case handling needed.

### 2. Tag selection algorithm

New Node script (matching the existing `apply-test-tag-map-fixes.mjs` precedent:
bash orchestrates, Node handles JSON-heavy logic), tentatively
`scripts/derive-test-change-tags.mjs`.

**CLI contract** (pinned here so the bash and Node sides can be built and tested
independently):

- argv: `--changed-files <path-to-newline-delimited-file-list> --selected-tags
  <comma-separated-tags-already-chosen>`
- stdout: newline-separated tag names to additively union into `TAGS` (empty
  output is valid — means nothing more is needed). Warnings (e.g. untagged
  touched files, see below) go to stderr, not stdout, so they never contaminate
  the tag list but can still surface in the Action log / PR comment.

**Algorithm:**

1. Run `npx playwright test --list --project e2e-electron --reporter=json`
   once. Scoping to a single project matters: run without `--project`, the
   same logical test is listed once per matching Playwright project (9
   projects are defined in `playwright.config.ts`), which would inflate every
   count by however many platform variants match. `e2e-electron` is also the
   semantically right scope regardless of the duplication bug — it's the lane
   every PR always runs by default, so it's the blast radius cost calculations
   should reflect. Verified empirically: unscoped listing showed
   `viewer.test.ts`'s 5 tests 5 times each (25 entries); `--project
   e2e-electron` gives exactly 5. Output returns, for every electron-project
   test: its file, title, declared `tags` array (reported without the leading
   `@`, e.g. `:console` not `@:console` — normalize when reading), and a
   `tests[].expectedStatus` field that reports `"skipped"` for anything under
   a static `test.describe.skip`/`test.skip`/`test.fixme`. This call doubles as
   the tag → test-count table (group by tag, count, excluding skipped specs).
2. Exclude any spec whose `tests[].expectedStatus` is `"skipped"` from
   consideration entirely — a statically-skipped test won't execute regardless
   of `--grep`, so it never needs a tag derived for it. (A *runtime-conditional*
   skip, e.g. `test.skip(condition, reason)` called inside a test body, can't
   be known at listing time by this mechanism or any other static means — not
   a gap specific to this design.)
3. For each touched file (from the PR's changed-files list, filtered to
   `test/e2e/tests/**/*.test.ts`, matched against the JSON's `file` field
   prefixed with `test/e2e/` since `testDir` is `./test/e2e`), look up the tags
   already declared on each of its non-skipped tests via the JSON from step 1.
   These declared tags are the **only** candidates ever considered — the
   script never invents a tag. If a touched file has non-skipped tests with
   zero declared tags, emit a stderr warning (e.g. "`foo.test.ts` has no
   declared tags — add tags or tag the PR body manually") — same advisory
   pattern as today's `unmapped_dirs` warning, never a hard failure.
4. Determine "already covered" **per individual test**, not per file: a touched
   test is covered iff at least one of *its own* declared tags is already in the
   PR's already-selected tag set (author-typed + src-path-map-derived +
   `@:critical` + `@:ark`, i.e. whatever `pr-tags-parse.sh` has accumulated
   before this step runs). A file with two differently-tagged `describe` blocks
   where only one block's tag is already selected still needs a tag chosen for
   the other block — coverage is never inferred at the whole-file level, only
   detection (step 1 above) is.
5. For touched tests not yet covered, solve for the minimal-additional-blast-radius
   tag or small tag set: among the candidate tags gathered in step 3, find the
   choice that minimizes the total number of *additional* tests pulled in
   (computed as true set-union size over each candidate tag's full matching-test
   set, not a naive sum of per-tag counts, since two candidate tags can overlap
   on the same test), subject to covering every not-yet-covered touched test. In
   practice, a single PR's touched-file set is small (expect low single digits
   of files, each with a handful of tags), so an exact brute-force search over
   the candidate-tag combinations is cheap; fall back to a greedy weighted
   set-cover if the candidate-tag universe ever exceeds ~20 (re-evaluate then,
   not preemptively).
6. Output the newly derived tag(s) for `pr-tags-parse.sh` to union into `TAGS` —
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

This is a breaking change for any in-flight PR that relies on `@:no-auto-tags`
while also adding a new Windows/web test: the platform tag would previously
auto-inject regardless, and after this change it won't. No migration/audit plan
or announcement is planned for this — `@:no-auto-tags` usage is rare today, and
this is accepted as a low-probability, easily-noticed-in-review risk rather than
something worth building tooling around.

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

- Where exactly `derive-test-change-tags.mjs` is invoked from within
  `pr-tags-parse.sh` (before/after the changed-files fetch that already
  happens there — avoid a duplicate `gh api` call if possible).

## Addendum: `pr-tags` job needs a new install step

The `pr-tags` job is dependency-free today (`actions/checkout` straight into
bash/`gh`/`jq`) -- no `node_modules` exists for `npx playwright test --list` to
run against. Investigated during plan-writing; resolved as: add
`actions/setup-node` (pinned via `.nvmrc`) plus a scoped, browser-free install
(`npm install --no-save @playwright/test@<version-from-root-package.json>` with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, and `npm --prefix test/e2e ci` for the
local fixture chain's real runtime deps, which `--list` must still import to
discover tests). This is the same dependency set `setup-e2e-test-dependencies`
already installs elsewhere in CI (proven to build on `ubuntu-latest`), just
without the browser download/`install-deps` steps, which aren't needed for
listing. Net effect: `pr-tags` gains a real but modest install cost it didn't
have before -- affects tag-selection latency, not e2e run time itself.
