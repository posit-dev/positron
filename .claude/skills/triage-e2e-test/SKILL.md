---
name: triage-e2e-test
description: Triage a specific Positron e2e test that is already failing or flaking in CI. Given a test name, surface its recent distinct failure modes from history, pull the evidence (trace, screenshots, logs) for each mode, and reason through the evidence to a root cause collaboratively with the engineer, landing on a concrete test fix or a product-bug repro. Test-centric counterpart to e2e-failure-analyzer (run-centric). For authoring a brand-new test, use author-e2e-tests.
disable-model-invocation: true
---

# Triage E2E Test

Test-centric triage: start from a test name (not a CI run), find its recent
distinct failure modes, fetch the evidence for each, and dig into the evidence
alongside the engineer until you have an actual root cause -- not just a label
-- then land on fix-the-test vs. file-a-bug with the action to match.

## When to Use

- You picked up a specific e2e test that is already failing or flaking in CI.
- You want its recent failure history and evidence without hunting for the runs
  by hand.

The test must already have CI failure history -- this skill reads what CI has
recorded. For a brand-new test you are writing from scratch, use
`author-e2e-tests` instead. For triaging a whole CI run rather than one test,
use `e2e-failure-analyzer` (run-centric).

## Prerequisites

- `E2E_INSIGHTS_API_KEY` set (for the history query) -- either as a shell env
  var, or as a line in the repo-root `.env.e2e` file (same local secrets file
  the e2e Playwright suite uses; see `.env.e2e.example`). The query script
  falls back to `.env.e2e` automatically if the env var isn't set.
- Node.js and `unzip` on PATH (the S3 processor extracts zip attachments).

## Scripts

This skill reuses the `e2e-failure-analyzer` scripts verbatim (no copies). Run
them from the positron repo root:

- `.claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js` - queries
  the `test-health` API. Call with `--occurrences-per-pattern 2` to get
  representative occurrences (with their S3 report URLs) per failure pattern.
- `.claude/skills/e2e-failure-analyzer/scripts/e2e-process-s3.js` - given a
  CloudFront report URL, downloads and parses the trace, screenshots,
  error-context page snapshot, and mines the logs.

## Input

A test name or spec path. Optional: `--lookback-days` (default 14, max 30)
and `--branch` to override the branches queried (default: the current git
branch plus `main` -- see step 2).

## Steps

### 1. Build the test key

The API keys tests as `testName|||specPath`, where `testName` is the **full
hierarchical Playwright title** -- every enclosing `test.describe()` block
joined to the `test()` title with `" > "`, not just the leaf title. E.g. for:

```ts
test.describe('Source Content Management', ..., () => {
  test('Verify SCM Tracks File Modifications, Staging, and Commit Actions', ...)
```

the key's `testName` is `"Source Content Management > Verify SCM Tracks File
Modifications, Staging, and Commit Actions"`, not just the inner string. Using
only the leaf title silently returns an empty/zero-runs result (looks like a
clean test, actually a key mismatch) rather than an error -- if a query comes
back with `total_runs: 0` for a test you know runs regularly, rebuild the key
with the full describe-chain prefix before concluding it's clean.

If you only have a partial name, grep `test/e2e/tests/` to find the exact
title and spec path, then walk outward to collect every enclosing
`test.describe()` title.

### 2. Query failure history

**Determine which branch(es) to query.** Run `git branch --show-current` for
the working branch. If it's `main`, query once. Otherwise query **twice** --
once with `--branch <current-branch>`, once with `--branch main` -- and merge
the two responses. Querying only the current branch risks two false
negatives: a brand-new branch with no CI runs yet reports `total_runs: 0` even
though the test has a long, well-documented history on main, and a branch
with just one passing run can mask an established flake that main's history
would show clearly. Querying only main risks missing something the current
branch itself introduced that hasn't landed on main. Querying both closes
both gaps. Skip the second call only when the current branch already is
`main`, or the engineer explicitly overrides `--branch`.

Always pass `--test-keys` as a JSON array, even for a single key. The API also
accepts a plain comma-separated string, but it splits on every comma in that
string to find multiple keys -- a test name that itself contains a comma (e.g.
"Verify SCM Tracks File Modifications, Staging, and Commit Actions") gets
mis-split and rejected with a 400. The JSON array form has no such ambiguity:

```bash
node .claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js \
  --repo positron \
  --test-keys '["<testName>|||<specPath>"]' \
  --branch <current-branch> \
  --lookback-days 14 \
  --occurrences-per-pattern 2

node .claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js \
  --repo positron \
  --test-keys '["<testName>|||<specPath>"]' \
  --branch main \
  --lookback-days 14 \
  --occurrences-per-pattern 2
```

The response's `failure_patterns[]` is your map: each entry is a distinct
failure mode (count-descending), with `count`, `percentage`, and up to two
representative `occurrences` carrying `sha`, `os`, `browser`, `outcome`
(`failed` | `flaky`), `run_url`, and `report_url`.

When you queried two branches, merge their `failure_patterns[]` into one list
before building the step 3 table: match entries across the two responses by
failure-mode text/selector (the same signal that identifies a row in the
table), not by array position or count, since ordering and counts can differ
per branch. Tag each merged row with which branch(es) it was observed on
(`main only`, `<branch> only`, or `both`).

If a response is `{}` the API was unreachable (or the key is unset) for that
call; say so and stop rather than guessing -- don't silently fall back to the
other branch's result as if it were complete.

Evaluate "no failures" and the zero-runs check **per branch**, not on the
merged total:

- If the current branch alone reports `total_runs: 0` while main has real
  history, that is expected for a new or not-yet-pushed branch -- not a
  key-mismatch -- proceed with main's data and note that the branch has no
  history of its own yet.
- If **both** branches report `total_runs: 0`, that's a key-mismatch, not a
  clean record -- see the full-title warning in step 1. A test with real CI
  history never reports zero total runs on every branch queried.
- Only report a clean bill of health -- "no failures for this test in the last
  N days on `<branch(es)>`" -- when every branch queried has nonzero
  `total_runs` and an empty `failure_patterns`. There is nothing to triage.

### 3. Summarize the failure modes FIRST

Before downloading anything, present the shape as a table so the engineer can
scan it at a glance -- a run-on sentence packing selector text, counts, and
environment lists together is hard to read. When step 2 queried two branches,
add a "Seen on" column so the engineer can immediately tell whether a mode is
new to their branch or an established main flake:

| # | Failure mode | Count | % | Environments | First seen | Seen on |
|---|---|---|---|---|---|---|
| A | `toBeVisible()` timeout: `getByLabel('...')...` | 104 | 99% | ubuntu/debian/opensuse/rhel/sles (chromium+electron), 1x win | Jul 07 | both |
| B | `locator.click` timeout: `.monaco-list-row...` | 1 | 1% | win/electron only | -- | main only |

(Keep the "Seen on" column whenever two branches were queried, even if one
contributed zero patterns -- e.g. every row reading `main only` is itself the
signal that nothing has reproduced on the current branch yet, likely because
it has no CI runs of its own. Drop the column only when a single branch was
queried.)

**Deciding whether to ask before digging in:** if one pattern is clearly
dominant -- rule of thumb: >=90%, or every other pattern is a single
occurrence -- proceed straight to deep-diving it without stopping to ask; list
the minor pattern(s) in the table but don't pull full evidence for them unless
the engineer asks, or the dominant pattern's root cause doesn't plausibly
explain them too. If the split is more even (60/40, 50/30/20) but neither
pattern is dominant nor a lone outlier, don't jump straight to asking which to
prioritize -- pull a quick round of evidence for both first (step 4) and check
whether they're actually the same underlying bug wearing two different error
messages (e.g. two assertions racing against the same continuously-changing
state). If they turn out to share a mechanism, there's nothing left to
prioritize between. Only ask once you've ruled that out, or the two patterns'
evidence points at genuinely unrelated mechanisms -- that split is a real
judgment call about where to spend effort, not an obvious default.

### 4. Pull evidence per pattern

For each pattern worth digging into (see the dominance rule above -- a lone
minor pattern may not need its own evidence pull), run the S3 processor against
its representative `report_url`. The API's `report_url` ends in
`/index.html`, often followed by a `#?testId=<id>` fragment identifying which
test in that report you actually care about. `e2e-process-s3.js --report-url`
expects the base **directory** URL (it appends `index.html` itself, so passing
the full URL/fragment yields a malformed path) -- strip everything from
`index.html` onward with `%%...*` (plain `%index.html` only strips an exact
trailing match and silently no-ops when a `#?testId=` fragment follows it):

```bash
# report_url = https://d38p2avprg8il3.cloudfront.net/playwright-report-.../index.html#?testId=e1e84091881625d98b53-...
base_url="${report_url%%index.html*}"   # -> https://d38p2avprg8il3.cloudfront.net/playwright-report-.../
filter_args=(--title "<exact hierarchical title from step 1>")
if [[ "$report_url" == *"testId="* ]]; then
  test_id="${report_url#*testId=}"      # -> e1e84091881625d98b53-...
  filter_args=(--test-id "$test_id")
fi
node .claude/skills/e2e-failure-analyzer/scripts/e2e-process-s3.js \
  --report-url "$base_url" \
  "${filter_args[@]}" \
  --output-dir <scratch-dir>/<pattern-n> \
  --cleanup
```

**Always pass `--title "<full test title>"` or `--test-id "<id>"` when you know
which test you're after.** A CI report bundles every failure from that shard,
often several unrelated tests -- without the filter you pay to download, parse,
and print full traces/logs/screenshots for all of them, when this skill only
ever wants evidence for the one test being triaged. Prefer `--test-id` when the
report_url carries the fragment (exact match, no title-collision risk); fall
back to `--title` with the exact hierarchical title from step 1 otherwise --
never pass `--test-id` with the raw `report_url` when the fragment is absent,
since that matches nothing and silently skips evidence collection.

This yields the trace timeline, screenshots, the error-context page snapshot,
and mined log excerpts for that mode. If you ever do need to slice the result
further (e.g. pull just one attempt's timeline out of a multi-test result),
pipe through `jq` rather than reading the raw dump -- progress messages go to
stderr and only the final JSON hits stdout, so `node e2e-process-s3.js ... | jq
'.testDetails[0].attempts[0].trace.timeline'` works cleanly.

The mined log excerpt is a grepped, truncated summary -- if it doesn't explain
the mechanism (e.g. a UI action silently does nothing, with no error to grep
for), that's not proof the logs lack the answer. Rerun without `--cleanup` and
read the full raw log files under the kept temp dir directly; the excerpt can
miss the multi-step sequence (activate, create, cancel, reconnect, ...) needed
to see what actually happened.

If an occurrence has `report_url: null`, state it explicitly (e.g. "3 of 8
occurrences have no report available") rather than assuming the pattern is fully
covered by the reports that do exist.

A 403 from `e2e-process-s3.js --report-url` means "this particular upload isn't
fetchable" (e.g. still in flight, or since expired), not "no evidence exists
for this pattern." Fall through to the next occurrence's `report_url` for the
same pattern rather than concluding the pattern is unevidenced.

### 5. Sleuth each pattern to a root cause

This is a collaborative dig, not a rubber-stamped verdict. Don't force the
failure into a "test-drift or product-regression" binary -- plenty of real
causes are neither (a shared-workspace race between two unrelated tests, a
resource-contention slowdown, an extension that floated to a new build, etc).
The e2e-failure-analyzer rubric (`../e2e-failure-analyzer/rubric.md`) has the
full catalog of root-cause categories and how to read the evidence for each
(trace timeline, error-context snapshot, sibling tests, log excerpts) -- use it.

For each failure mode:

1. State what it is, citing the evidence (trace step, log line, screenshot).
2. Reason out loud through what the evidence rules in and out, the way you
   would talking it through with the test's author. Follow leads: if the
   error-context snapshot shows something unexpected (an unrelated fixture's
   files, a surprising element count, a different surface than the test
   targets), chase it -- that is usually where the real mechanism lives, not
   in the assertion that happened to trip.
3. Land on the actual mechanism, then propose a fix that addresses it. A fix
   that could not plausibly change the failure rate is not a fix -- keep
   digging instead of settling for one.

When the trace/logs point at a mechanism that lives outside the failing spec
file -- a POM helper, a shared fixture, or product source under `src/vs/**` --
tracing it usually means several rounds of grep-and-read across files you
haven't opened yet. Delegate that tracing to an `Explore` subagent rather than
doing it inline: give it the specific symbol/selector from the evidence (e.g.
"trace which caller invokes `Sessions.getMetadata()` during test setup, and
what `activePositronConsoleInstance` is and when it updates") and have it
report back the call chain and relevant line numbers. This keeps the dozen-plus
exploratory reads out of the main conversation's context, which matters
because that context is still needed for reasoning through the evidence and,
later, writing the fix.

Two cross-checks that pay off disproportionately for their cost:

- **Environment_breakdown skew.** If a pattern clusters on specific OS/browser
  combos, check whether that split tracks worker count/parallelism rather than
  a platform-specific bug -- e.g. CI images running more parallel workers hit
  shared-fixture races that near-idle mac/win runs rarely do.
- **Prior art.** Run `git log --oneline -- <spec path>` before proposing a fix.
  A recent commit fixing the same failure class on this same test is a strong
  signal for both the mechanism and the fix idiom this codebase already uses
  -- reuse it instead of reinventing one. But prior art tells you the idiom the
  codebase likes, not that it's guaranteed to transfer to your specific
  mechanism -- still verify it with the repro in step 6 before trusting it,
  even when it looks obviously right.

**Never propose increasing a timeout as the fix**, including as a "quick win"
or stopgap. It hides the real race, contention, or isolation problem instead of
addressing it, and usually just narrows the window rather than closing it. If
the evidence points at a specific mechanism (e.g. a shared fixture, a slow
decoration provider, a concurrent teardown), name that mechanism and fix it or
isolate it -- do not paper over it with a longer wait.

### 6. Reproduce before fixing, verify after -- don't trust one green run

**Pick a project to repro against, easiest first.** Only three projects are
actually exercised in CI (see the `e2e` jobs in a `positron-builds` release
workflow run) -- start at the top and only move down if you have a specific
reason to (e.g. the failure pattern's `environment_breakdown` is concentrated
on one of them):

1. `e2e-electron` -- standard desktop app, no extra setup. Covers macOS,
   Windows, and Ubuntu in CI (`e2e / desktop / electron (...)`). Try this
   first unless the test is tagged web-only.
2. `e2e-chromium` -- browser against a managed server, no extra setup. Covers
   debian/sles/opensuse/rhel in CI (`e2e / web / chromium (...)`).
3. `e2e-workbench` -- browser against a container running both Positron and
   Workbench (`e2e / pwb ubuntu / ...` in CI). Requires `npm run pwb` to bring
   the stack up first (add `-- --credentials=<databricks|snowflake|azure>`
   only if the test exercises a managed data-source connection); see
   `docker/environments/workbench-dev/README-positron-workbench.md`.

(`playwright.config.ts` defines several other projects -- `e2e-server`,
`e2e-firefox`, `e2e-webkit`, `e2e-edge`, `e2e-connect`, `e2e-remote-ssh`,
`e2e-remote-wsl`, `e2e-jupyter`. Of these, only `e2e-remote-ssh`,
`e2e-remote-wsl`, and `e2e-jupyter` actually run in CI, each for a narrow set
of tests tagged for that surface -- reach for one only if the failing test is
tagged for it. `e2e-server` isn't run in CI at all; don't default to it.)

```bash
npx playwright test <spec> --project <project> --grep '<test name>'
```

For a deterministic failure, confirm it fails the same way on the picked
project before touching code, then confirm the fix makes that same run pass.

For a flaky/race-driven failure -- the common case this skill exists for -- a
single local pass or fail proves little; the failure depends on timing or
worker interleaving you can't force on demand:

1. **Force the mechanism directly, if you can.** If the root cause is a
   specific concurrent condition (e.g. two specs racing on a shared fixture),
   reproduce that condition by hand -- e.g. manually drop the polluting state
   into the shared workspace, or run the two colliding spec files together
   with the real worker count -- and confirm the assertion fails before the
   fix and passes after. This is the closest thing to a real repro for a race,
   and worth the extra setup time when it's feasible.
   - **No shared fixture, but the mechanism is load/timing-sensitive anyway**
     (e.g. a foreground-session/focus race, a debounced UI update) -- a lone
     spec run on an idle local machine has none of the contention that
     surfaces it. Run the failing spec alongside a sibling spec that exercises
     the same racy code path, with `--repeat-each` on both: `npx playwright
     test specA.test.ts specB.test.ts --project e2e-electron --repeat-each=4`.
     Real worker contention -- not a shared fixture -- is what triggers the
     race; recreate the contention, not just the repeat count.
2. **Repeated local runs are weak evidence, not proof.** `--repeat-each=N` on
   the affected spec passing N/N locally does not confirm the race is gone,
   especially when the race depends on contention from unrelated specs that
   repeat-each won't recreate. State it as "didn't reproduce locally" or "no
   trigger of the flake in N tries," not as "confirmed fixed."

**If the failure pattern looks environment-specific** (e.g.
`environment_breakdown` shows it only on certain OS/browser combos, or you
suspect something about the actual CI image rather than a timing race), the
projects above still run on your local machine/OS -- they won't surface an
issue that's really about the CI runner image itself. For that, reproduce on
the real CI image per `.devcontainer/ci-arm/README.md` (Posit-internal, arm64
access required -- see the gating note in this repo's root `CLAUDE.md`).

Don't claim a flaky test is "fixed" on the strength of a single green run,
local or in CI -- for a race, evidence is a trend across enough runs, not one
data point.

## Non-goals

- No new S3 uploads or API changes -- consumes the existing `test-health`
  endpoint and existing S3 reports.
- No run-level triage -- that is `e2e-failure-analyzer`'s job.

`e2e-process-s3.js` is shared with `e2e-failure-analyzer`; the `--title` /
`--test-id` filter flags are additive and don't change its default (no filter)
behavior, so run-level triage is unaffected.
