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

See [`../e2e-failure-analyzer/scripts/README.md`](../e2e-failure-analyzer/scripts/README.md#building-a-test-key)
for the `testName|||specPath` format. `testName` must be the **full
hierarchical Playwright title** -- every enclosing `test.describe()` joined to
the `test()` title with `" > "` -- or the query silently returns an
empty/zero-runs result (looks like a clean test, actually a key mismatch)
instead of an error.

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

Always pass `--test-keys` as a JSON array, even for a single key -- see
[`../e2e-failure-analyzer/scripts/README.md`](../e2e-failure-analyzer/scripts/README.md#--test-keys-always-pass-a-json-array-even-for-one-key)
for why the comma-separated form is unsafe:

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
before building the step 4 table: match entries across the two responses by
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

### 3. Check for a recent triage attempt on this test

Before presenting the failure table, check whether this test already has a
fix in flight or recently landed -- so the diagnosis doesn't re-propose an
idea that's already been tried, or re-litigate a mode a prior fix already
addressed. This is a lightweight, single-test lookback, not the full
scored-eval pipeline (that runs separately, on a schedule).

Reuse the same search step 8 uses to find diagnosis blocks, but pull `body`
too so you can filter it locally to this test:

```bash
gh search prs --repo posit-dev/positron --match body "E2E Triage Diagnosis" \
  --json number,title,url,mergedAt,state,body --limit 50
```

The search matches the heading in *every* diagnosis block ever posted, not
just this test's -- filter the results yourself for a body containing this
test's exact spec path (from step 1's key). Discard anything that doesn't
match; a shared heading with a different test's diagnosis has nothing to say
about this one.

For each PR whose body does name this spec:

- **Still open.** There's an unlanded attempt in flight. Say so and stop here
  rather than starting a parallel diagnosis -- point the engineer at the open
  PR instead of re-running the same investigation.
- **Merged.** This is the case that answers "did the fix work?" Get the merge
  commit with `gh pr view <number> --json mergeCommit,mergedAt`, then check
  which of step 2's occurrences post-date it:

  ```bash
  git merge-base --is-ancestor <fix-merge-sha> <occurrence-sha> \
    && echo "after fix" || echo "before fix / unrelated history"
  ```

  Run this per occurrence SHA from the merged `failure_patterns`. If a SHA
  isn't found locally, `git fetch origin` first -- occurrence SHAs come from
  CI runs across branches your local clone may not have fetched yet.
  - Occurrences that are **not** descendants of the fix commit are old news
    already covered by that PR's diagnosis -- don't re-litigate them.
  - Occurrences that **are** descendants mean the failure recurred after the
    fix meant to close it. Lead with this once you reach step 4: e.g.
    "recurred after PR #123 (merged Jul 15), which hypothesized <one-line>."
    Treat that prior hypothesis as ruled out, not as a guess worth re-testing
    -- the evidence already says it didn't hold, so step 6's sleuthing should
    start from "why didn't that fix work" rather than re-deriving the same
    mechanism.
  - If there are zero occurrences since the merge and enough runs have
    accumulated in that window to be meaningful, the fix looks like it held --
    say so. If `failure_patterns` is now empty, that's a clean bill of health,
    not a fresh test to triage.
  - If the merge is very recent and few or no runs have happened since, say
    that explicitly ("not enough runs since PR #123 merged to tell yet")
    rather than declaring the fix a success or failure prematurely.

If no PR's body names this test, there's nothing to reconcile -- proceed to
step 4 as normal.

### 4. Summarize the failure modes FIRST

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
prioritize -- pull a quick round of evidence for both first (step 5) and check
whether they're actually the same underlying bug wearing two different error
messages (e.g. two assertions racing against the same continuously-changing
state). If they turn out to share a mechanism, there's nothing left to
prioritize between. Only ask once you've ruled that out, or the two patterns'
evidence points at genuinely unrelated mechanisms -- that split is a real
judgment call about where to spend effort, not an obvious default.

These percentages are a snapshot of the raw lookback window, not necessarily
the current state -- step 6's prior-art check can later reveal that a
pattern's occurrences all predate an unrelated fix that happened to cover this
mechanism too, which makes its share of the table stale. Don't re-litigate
that here; it only becomes knowable once a mechanism and its evidence are in
hand.

### 5. Pull evidence per pattern

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

The mined log excerpt (`logExcerpt`, per test in `testDetails[]`) is a grep for
error-shaped lines only (`no such file`, `traceback`, `\w+error:`, `failed to
\w+`, etc. -- see `LOG_ERROR_RE` in the script). It cannot show you sequence or
timing -- `[info]`-level lines never match, so a race (two things happening in
the wrong order, neither one erroring on its own) is invisible in the digest by
construction, not because the excerpt was truncated. Any time the question is
"what happened, in what order" rather than "what error was thrown," go straight
to the raw logs instead of trying to coax more out of the digest.

**To read the raw logs:** rerun the same command *without* `--cleanup`. The raw
`logs-<shortId>.zip` is NOT under `--output-dir` -- it's left in the OS temp
directory, at the path the script prints to stderr on its last line: `(temp dir
kept at /var/folders/.../T/e2e-process-s3-<hash> -- pass --cleanup to remove)`.
Unzip it and grep by extension-host channel -- each extension's real output
channel is its own file under `server/exthost2/<extension-id>/*.log` (e.g.
`ms-python.python/Python Language Pack.log`), separate from the top-level
`e2e-test-runner.log` the digest draws from:

```bash
# TMP is the exact path the script printed: "(temp dir kept at <TMP> -- ...)"
LZ=$(find "$TMP" -name 'logs-*.zip' | head -1)
DEST=<scratch-dir>/logs-extracted
mkdir -p "$DEST" && unzip -o "$LZ" -d "$DEST"
find "$DEST" -iname '*<extension-id-or-keyword>*'   # locate the right channel file
```

The excerpt can also miss the multi-step sequence (activate, create, cancel,
reconnect, ...) needed to see what actually happened even when it does find an
error line -- read the full channel file, not just the matched lines.

If an occurrence has `report_url: null`, state it explicitly (e.g. "3 of 8
occurrences have no report available") rather than assuming the pattern is fully
covered by the reports that do exist.

A 403 from `e2e-process-s3.js --report-url` means "this particular upload isn't
fetchable" (e.g. still in flight, or since expired), not "no evidence exists
for this pattern." Fall through to the next occurrence's `report_url` for the
same pattern rather than concluding the pattern is unevidenced.

### 6. Sleuth each pattern to a root cause

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
"trace which caller invokes `<method>` during test setup, and what `<field>`
is and when it updates") and have it report back the call chain and relevant
line numbers. This keeps the dozen-plus
exploratory reads out of the main conversation's context, which matters
because that context is still needed for reasoning through the evidence and,
later, writing the fix.

**Actively try to falsify your leading hypothesis, not just confirm it.** When
two mechanisms would both explain the surface symptom (e.g. "output split
across chunks" vs. "output dropped entirely"), grep the *raw* logs (not just
the mined excerpt) for the exact expected string across its full length. Total
absence of the string anywhere in the log rules out "split/mangled" and points
at "never arrived" -- a materially different mechanism with a different fix.
Don't settle for the first hypothesis that's merely consistent with the
symptom; check whether the evidence can rule out the alternatives too.

Three cross-checks that pay off disproportionately for their cost:

- **Environment_breakdown skew.** If a pattern clusters on specific OS/browser
  combos, check whether that split tracks worker count/parallelism rather than
  a platform-specific bug -- e.g. CI images running more parallel workers hit
  shared-fixture races that near-idle mac/win runs rarely do.
- **Prior art.** Run `git log --oneline -- <spec path>` before proposing a fix.
  A recent commit fixing the same failure class on this same test is a strong
  signal for both the mechanism and the fix idiom this codebase already uses
  -- reuse it instead of reinventing one.

  Once the evidence points at a specific mechanism, repeat the check against
  the **implicated source file(s)** too (a POM helper, a shared service,
  anything under `src/vs/**` the trace or logs named) -- not just the spec
  path:

  ```bash
  git log --oneline -- <implicated source file>
  ```

  A fix for your exact mechanism can land via a completely different test's
  triage and never mention this spec at all, so the spec-path-only log (and
  step 3's PR-body search, which only matches PRs naming this test) will both
  miss it. If this turns up a recent merge commit, don't stop at "prior art
  exists" -- partition this pattern's occurrences by ancestry to it, the same
  way step 3 partitions occurrences against a diagnosis PR's merge commit:

  ```bash
  git merge-base --is-ancestor <fix-commit> <occurrence-sha> \
    && echo "after fix" || echo "before fix"
  ```

  - **All sampled occurrences predate the fix:** the failure rate in step 4's
    table is stale -- this pattern may already be resolved. Say so explicitly
    instead of treating the raw percentage as current; widen
    `--occurrences-per-pattern` if two samples aren't enough to be confident.
  - **Some or all postdate the fix:** this mechanism is still live despite
    that fix -- either the fix doesn't cover this code path, or a second bug
    shares the same symptom. Keep digging; don't credit the existing fix with
    something it didn't do.
  - When a test has multiple failure patterns and this check splits them --
    one pattern's occurrences all predating a fix, another's all postdating
    it -- that split *is* the diagnosis: the predating pattern is old news the
    other fix already explains, and the postdating pattern is the one still
    worth root-causing. Lead with that split when you report back, rather
    than presenting both patterns as equally live.

  Prior art tells you the idiom the codebase likes, not that it's guaranteed
  to transfer to your specific mechanism -- still verify it with the repro in
  step 7 before trusting it, even when it looks obviously right.
- **Same-file preceding-test adjacency.** If the evidence points at another
  test in the same file leaking state (see the rubric's "Same-file
  preceding-test state leakage"), don't trust it off one occurrence -- pull
  evidence for a second, independent occurrence (different SHA, different run)
  and confirm both the timeline (disruptive event lands right before the
  failure) AND the adjacency (the report's sibling-test list places the same
  state-mutating test directly before the failing one) hold in both. This
  skill's multi-occurrence history is exactly what tells apart a reproducible
  same-file race from a coincidental one-run overlap that a single-run
  analyzer (which only ever sees one occurrence) can't rule out on its own.

**Never propose increasing a timeout as the fix**, including as a "quick win"
or stopgap. It hides the real race, contention, or isolation problem instead of
addressing it, and usually just narrows the window rather than closing it. If
the evidence points at a specific mechanism (e.g. a shared fixture, a slow
decoration provider, a concurrent teardown), name that mechanism and fix it or
isolate it -- do not paper over it with a longer wait.

### 7. Reproduce before fixing, verify after -- don't trust one green run

**Prefer a unit-level repro when the mechanism lives below the e2e layer.** If
the root cause traces into a lower-level module with its own unit-test suite
(e.g. an extension's process-spawning helper, not the e2e spec or a POM), write
a deterministic unit test there instead of relying on the flaky e2e repro. Model
the exact event ordering that triggers the bug (e.g. a Node child-process
`exit`/`close` race), confirm it fails against the current code (RED), apply
the fix, confirm it passes (GREEN). This is faster and more deterministic than
chasing a load-dependent e2e race, and it doubles as a regression test the e2e
repro alone wouldn't leave behind. Reach for the e2e project repro below when
the mechanism is genuinely e2e-layer (a POM race, a shared fixture, UI timing).

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
   `docker/environments/wb-local/README.md`.

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

**If the engineer asks why a long-standing bug started failing only recently,
that's a separate, weaker-evidence question from the root cause itself --
don't conflate "when the bug was introduced" with "when the failure rate
spiked."** Check `git log`/`git blame` on the actual fixed code to establish
the bug's age, then compare that against the test-health history's onset date
(the first date the failure pattern actually appears in the lookback window,
not just "recently"). If the bug predates the onset by a wide margin, look at
merges from the day(s) just before onset, but verify each candidate's *actual
mechanism* (does it change runtime versions, parallelism, CI image contents,
or load -- not just a plausibly-related commit title) before naming it as a
trigger. A commit whose diff doesn't actually change the behavior in question
(e.g. an action-version bump that keeps the pinned runtime the same) is not a
trigger regardless of how suggestive its title reads. If no candidate's
mechanism holds up, say so plainly -- "bug predates the spike; no confirmed
trigger identified" -- rather than presenting the most plausible-sounding
candidate as if it were proven.

### 8. Record the diagnosis on the PR

This skill is manual and doesn't open PRs itself, so this step fires whenever
the triage does lead to a PR (fix-the-test or a product-bug fix). Append an
`### E2E Triage Diagnosis` block to the end of the PR body -- after whatever
body template the change itself calls for (plain Summary/QA Notes for a
test-only change; the product PR template for a source fix -- see
`positron-pr-helper`'s `references/pr-templates.md` for the required fields,
e.g. `Fixes #`, `### Release Notes`, `### Validation Steps`; this is easy to
forget when the diagnosis block is the thing top of mind). The block is an
immutable snapshot of the skill's root-cause prediction at authoring time, so
its accuracy can be scored later against what actually fixed the flake.

```
### E2E Triage Diagnosis

<details>
<summary>🟢 <b>High confidence</b> -- <one-line hypothesis summary></summary>

- **Spec:** `<spec path>`
  - **Test:** `<full hierarchical test title>`
- **Signal:** <trace-timeline mechanism observation, not the bare assertion string>
- **Frequency:** <count/percentage + environment, e.g. "5/313 runs (1.6%), ubuntu/electron">
- **Hypothesis:** <root-cause mechanism -- race / isolation / contention / infra / product-bug>

</details>
```

If step 3 found a merged PR whose fix didn't hold, add a **Supersedes** bullet
naming it (`Supersedes: #123 (hypothesized <one-line>, recurred N times
after merge)`) so a later reader -- human or the eval pipeline -- can see this
is attempt #2, not attempt #1, without re-running the git-merge-base check.

Field notes:

- **Spec and Test lead every block -- never drop them.** Each block names the
  spec path and the **full hierarchical test title** (every enclosing
  `test.describe()` joined with `" > "`, same key as step 1) -- they're the
  block's identity, what makes it findable and scoreable per-test later. A
  product-bug block whose fix lives in source still gets them: the diagnosis is
  keyed to the test that surfaced it, not to the file being changed (this is
  the field easiest to forget precisely on those blocks). When one block covers
  more than one test, give each its own `Spec` + `Test` pair rather than
  collapsing them into a prose "`pathA` and `pathB`" that a later per-test
  search won't match.
- **Confidence emoji:** 🟢 high, 🟡 medium, 🔴 low. Keep the word "confidence"
  in plain text next to the emoji so the block stays greppable for later
  scoring.
- **Signal is the highest-leverage field, and the easiest to get lazy on.**
  Pull the timeline shape from the step 5-6 evidence -- what the trace or
  snapshot actually showed (e.g. "markers render right after import, then
  disappear before the assertion runs") -- not the step-4 failure-pattern
  string ("`toBeVisible()` timed out"), which can't tell "never rendered" from
  "rendered then clobbered": two unrelated root causes.
- **Frequency** is its own bullet -- it's a different kind of evidence (how
  often / where) than the Signal mechanism observation.
- `<details>` collapsing is rendering-only: `gh api` / `gh pr view --json body`
  still return the full text, so nothing is lost for later scoring.

Do NOT edit the block after merge to record whether the hypothesis turned out
right -- that would rewrite a merged PR description as ground truth arrives
late. Outcome scoring lives in a separate log keyed by PR number. To find every
PR carrying a diagnosis, full-text search the heading (no label needed):

```bash
gh search prs --repo posit-dev/positron --match body "E2E Triage Diagnosis" \
  --json number,title,url
```

When appending the block to an existing PR, edit the body with `gh api
repos/<owner>/<repo>/pulls/<n> -X PATCH -F body=@<file>` -- `gh pr edit` fails
on the Projects-classic GraphQL deprecation.

## Non-goals

- No new S3 uploads or API changes -- consumes the existing `test-health`
  endpoint and existing S3 reports.
- No run-level triage -- that is `e2e-failure-analyzer`'s job.

`e2e-process-s3.js` is shared with `e2e-failure-analyzer`; the `--title` /
`--test-id` filter flags are additive and don't change its default (no filter)
behavior, so run-level triage is unaffected.
