---
name: triage-e2e-test
description: Triage a specific Positron e2e test that is already failing or flaking in CI. Given a test name, surface its recent distinct failure modes from history, pull evidence for one mode, and reason to a root cause collaboratively with the engineer, landing on a concrete test fix or a product-bug repro. Test-centric counterpart to e2e-failure-analyzer (run-centric). For authoring a brand-new test, use author-e2e-tests.
disable-model-invocation: true
---

# Triage E2E Test

Start from a test name (not a CI run), find its recent distinct failure modes,
investigate one, falsify a root-cause mechanism, and land on fix-the-test vs.
file-a-bug with the action to match. This is an orchestrator: deterministic work
lives in `scripts/`, and detailed procedures live in `references/` that you read
only when a stage needs them.

## When to use

- You picked up a specific e2e test already failing or flaking in CI, and want
  its history and evidence without hunting for the runs by hand.
- The test must already have CI history. For a brand-new test, use
  `author-e2e-tests`. For triaging a whole CI run, use `e2e-failure-analyzer`.

## Non-negotiable rules

- **Zero runs is never a clean result** -- only nonzero runs with no failure
  patterns is.
- Resolve the exact **full hierarchical** test title and spec path.
- Investigate **one** selected pattern at a time; ask which when there's more
  than one.
- Fetch **one** representative occurrence first; a second needs a stated reason.
- Escalate evidence only to answer a concrete question. Keep large output on
  disk, not in the conversation.
- **Never** increase a timeout or add an arbitrary wait as the fix.
- **Never** claim a flaky test is fixed on one green run.
- A previous merged fix must be checked against subsequent failures.
- Root-cause claims cite observed evidence and the alternatives ruled out.
- Checkpoint before pausing or beginning implementation.

Violating the letter of these rules is violating their spirit.

## Prerequisites

- `E2E_INSIGHTS_API_KEY` set, or present in the repo-root `.env.e2e` (the query
  script falls back to it automatically). Node.js and `unzip` on PATH.

## Scripts

Run from the repo root. All emit **compact JSON to stdout** and write full
payloads to the per-triage work directory `.claude/work/triage-e2e-test/<id>/`
(gitignored). They wrap the `e2e-failure-analyzer` scripts (no copies).

- `scripts/triage-history.js` -- dual-branch history retrieval + merge. Resolves
  the branch, queries the current branch and `main`, merges patterns by failure
  text, computes counts/%/seen-on, classifies zero-run conditions, selects one
  representative occurrence per pattern. Defaults to `--occurrences-per-pattern 1`.
- `scripts/find-prior-triage.js` -- filtered prior-triage lookup. Finds PRs whose
  body names this spec, extracts diagnosis fields, resolves merge SHAs, and
  partitions occurrence SHAs into before-fix / after-fix.
- `scripts/fetch-pattern-evidence.js` -- summary-first evidence for one
  occurrence. Runs the S3 processor filtered to this test, stores full evidence
  on disk, generates a compact `summary.md`.
- `scripts/checkpoint.js` -- durable state for start / resume / status. Setting
  `phase` auto-derives `nextAction`, so a resume always shows the right next
  step (pass `--set nextAction=...` only to override). Refuses `phase=done`
  until an `outcome` is set and (for PR/issue outcomes) the diagnosis block is
  recorded -- the mechanical guard against calling a triage done before the
  block lands.
- `scripts/record-diagnosis.js` -- renders the `### E2E Triage Diagnosis` block
  from the checkpoint + history and appends it to the resolving PR (`--pr`) or
  issue (`--issue`). Idempotent. Only writer of `diagnosisBlockRecorded`, so it
  is what unblocks `phase=done`. Opening a PR via `positron-pr-helper` does NOT
  record the block -- run this after.

Each helper appends one line (duration, stdout bytes, raw bytes written, plus
phase-specific counts) to `.claude/work/triage-e2e-test/metrics.jsonl` -- passive
cost instrumentation, best-effort, nothing to invoke. See
[`references/metrics.md`](references/metrics.md) to read or aggregate it.

## Start or resume

`/triage-e2e-test "<test>"` -- start. `/triage-e2e-test --resume <triage-id>` --
resume. `/triage-e2e-test --status` -- list saved triages.

**On `--resume`:** run `node scripts/checkpoint.js --triage-id <id> --read`,
validate it, and continue from `phase` / `nextAction`. Do **not** repeat
completed history or evidence work unless the engineer asks to refresh, the
saved data is invalid, or the branch/test identity changed. The read output
includes a `freshness` block; if `freshness.stale` is true (history older than
~24h), tell the engineer how old it is and ask whether to re-run the history
helper before continuing, rather than silently reasoning over stale data.

**On `--status`:** `node scripts/checkpoint.js --status`.

**Otherwise (new triage):**

1. Resolve the exact test identity into a `testName|||specPath` key. If you only
   have a partial name, read [`references/history-query.md`](references/history-query.md#building-the-test-key).
2. Run the history helper:
   ```bash
   node .claude/skills/triage-e2e-test/scripts/triage-history.js \
     --test-key '<testName>|||<specPath>' --lookback-days 14
   ```
3. Act on its `verdict`. `stop: true` (`zero-runs-both`, `clean`) or an `error`
   field means stop and report -- read [`references/history-query.md`](references/history-query.md)
   for what each verdict means. Otherwise continue.
4. Initialize a checkpoint and record the patterns:
   ```bash
   node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> \
     --init --test-key '<key>'
   ```
5. Check for prior triage before presenting the table:
   ```bash
   node .claude/skills/triage-e2e-test/scripts/find-prior-triage.js \
     --spec-path '<specPath>' --triage-id <id> \
     --occurrence-shas '["<sha1>","<sha2>"]'
   ```
   A non-`none` verdict changes the plan -- read [`references/prior-triage.md`](references/prior-triage.md).
   `open-attempt-in-flight` means stop and point at the open PR.
6. **Present the failure modes as a table** (never a run-on sentence). Include a
   "Seen on" column whenever two branches were queried:

   | # | Failure mode | Count | % | Environments | Seen on |
   |---|---|---|---|---|---|
   | A | `toBeVisible()` timeout: `getByLabel('...')` | 104 | 99% | ubuntu/electron | both |
   | B | `locator.click` timeout: `.monaco-list-row` | 1 | 1% | win/electron | main only |

7. **Ask which pattern to prioritize whenever the table has more than one row.**
   Give your own read ("A is dominant at 99% -- start there, or focus on B?")
   but let the engineer decide; they may know a recent fix made the dominant
   share stale, or already know which failure they care about. A single pattern
   needs no choice. Save the selection to the checkpoint (`--set
   selectedPattern=A --set phase=pattern-selected`).

## Investigate the selected pattern

1. Fetch evidence for the pattern's representative occurrence:
   ```bash
   node .claude/skills/triage-e2e-test/scripts/fetch-pattern-evidence.js \
     --report-url '<representativeOccurrence.report_url>' \
     --triage-id <id> --pattern A
   ```
   (The helper strips the `index.html#?testId=` fragment and filters the report
   to this one test itself.)
2. Read the generated `summary.md` (failure, timeline tail, sibling tests,
   error-shaped logs, unresolved questions). **Read only the summary first.**
3. State the concrete questions that remain, then escalate to a single artifact
   / raw logs / a second occurrence **only** to answer one of them. The
   escalation ladder, raw-log spelunking, and 403/null handling are in
   [`references/evidence-escalation.md`](references/evidence-escalation.md).
4. Save `phase=evidence-gathered` to the checkpoint.

## Determine root cause

This is a collaborative dig, not a rubber-stamped verdict. Use the
`e2e-failure-analyzer` rubric ([`../e2e-failure-analyzer/rubric.md`](../e2e-failure-analyzer/rubric.md))
for the root-cause catalog and how to read each evidence type. Don't force the
failure into a "test-drift vs product-regression" binary -- shared-workspace
races, resource contention, and floated extension builds are none of those.

State: the observed mechanism (citing trace step / log line / screenshot); what
the evidence rules **in and out**; alternatives ruled out; remaining
uncertainty; and a fix that could plausibly change the failure rate (a fix that
couldn't is not a fix -- keep digging).

**Actively try to falsify your leading hypothesis, not just confirm it.** When
two mechanisms would both explain the symptom, grep the raw logs for evidence
that separates them.

**Delegate cross-file tracing to an `Explore` subagent** only after the evidence
names a concrete symbol / selector / event / subsystem. Give it the specific
lead; require a compact response and **cap it**: a probable call chain (<=8
entries), <=5 files with exact line ranges, one mechanism summary, <=3 open
questions. It must not return full file contents, a repo tour, or speculation
unsupported by evidence.

Save the diagnosis to the checkpoint (`--patch` a `diagnosis` object) and set
`phase=hypothesis-ready`. Include the fields `record-diagnosis.js` renders
(`confidence`, `summary`, `targetedFailure`, `signal`, `hypothesis`, optional
`supersedes`) -- see [`references/diagnosis-block.md`](references/diagnosis-block.md)
for what each must contain.

## Reproduce and fix

**Checkpoint the diagnosis, then `/clear` and `--resume <id>` before
implementing.** History and evidence are durable on disk, so implementation
should start from a **clean context carrying only the compact diagnosis** --
don't drag the whole investigation into the fix, where cross-file edits, tests,
and verification runs will grow context fast. Set `phase=awaiting-clear` before
clearing; on resume, set `phase=implementation`.

Read [`references/reproduction.md`](references/reproduction.md) at this stage.
In short:

- When the mechanism is below the e2e layer, write a deterministic lower-level
  regression test via `author-vitest-tests` (it owns the builder/stub
  conventions and `review-vitest-tests`, but drives toward green -- **the RED
  bar is yours to hold**: a valid RED reproduces the diagnosed mechanism inside
  the assertion, not an import/compile/setup error. See `reproduction.md`).
- Otherwise use the smallest CI-exercised e2e project and recreate the
  triggering condition, not just a rerun. For a race, one green run is not proof.
- Keep verification output on disk or in the background (the `--repeat-each`
  loop is noisy) -- read a summary, don't stream full runs into context.

## Record the result and close out

Every triage ends by declaring an `outcome` and recording its diagnosis -- this
is not optional, and `checkpoint.js` refuses `phase=done` until it's satisfied.
The outcome spans two axes (what you found x what you did):

| Outcome | Meaning | Where the block goes | To reach `done` |
|---|---|---|---|
| `fix-test` | test bug, fixed in a PR | the PR | `record-diagnosis.js --pr <n>` |
| `fix-product` | product bug, fixed in a PR | the PR | `record-diagnosis.js --pr <n>` |
| `file-issue` | product bug, filed not fixed | the new issue | `record-diagnosis.js --issue <n>` |
| `no-op` | not fixed and not filed (accepted flake, dup, backlog, handed off) | checkpoint only | `--set outcomeReason="..."` |

`outcome` is the **primary** artifact -- a secondary note (e.g. mentioning a
product race in the backlog while you fix the test) does not change it.

**A returning sub-tool is not the end of the triage** -- opening the PR via
`positron-pr-helper` or a passing `author-vitest-tests` run resolves a *step*.
Once the PR/issue exists:

1. `record-diagnosis.js --triage-id <id> --pr <n>` (or `--issue <n>`) appends the
   block and sets `outcomeRef` + `diagnosisBlockRecorded`. For a `no-op`, skip
   this and `checkpoint.js --set outcome=no-op --set outcomeReason="..."` instead.
2. `checkpoint.js --set phase=done`.

## Non-goals

- No new S3 uploads or API changes -- consumes the existing `test-health`
  endpoint and existing S3 reports.
- No run-level triage -- that is `e2e-failure-analyzer`'s job.
