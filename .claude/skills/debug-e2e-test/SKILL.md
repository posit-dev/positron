---
name: debug-e2e-test
description: Use when investigating a specific named Positron e2e (Playwright) test that is failing or flaking -- in CI ("why is <test> failing on main", "this test is flaky in CI", "is this a test bug or a product bug") or on the engineer's machine ("this e2e test just failed locally", "debug this e2e failure"). From CI it surfaces the test's distinct failure modes from history and pulls evidence for one; locally it reads the run's own trace, snapshot, and logs. Either way it reasons to a falsifiable root cause with the engineer and lands on a test fix, a product-bug issue, or an accepted-flake note. Do NOT use for: a test you are writing or currently editing (author-e2e-tests); a whole CI run's failures, or a run ID/URL (e2e-failure-analyzer); Vitest or extension-host failures.
---

# Debug E2E Test

Start from a test name (not a CI run), find its recent distinct failure modes,
investigate one, falsify a root-cause mechanism, and land on fix-the-test vs.
file-a-bug with the action to match. This is an orchestrator: deterministic work
lives in `scripts/`, and detailed procedures live in `references/` that you read
only when a stage needs them.

## When to use

You picked up one specific e2e test that is failing or flaking, and want its
evidence without hunting for it by hand. **Two entries, one triage.** They differ
only in where the evidence comes from; everything from "read the summary" onward
is identical.

| | **CI entry** | **Local entry** |
|---|---|---|
| Use when | the test fails/flakes in CI | it just failed on this machine |
| Evidence | `test-health` history -> one occurrence's report | this run's `test-results/` artifacts |
| Needs | `E2E_INSIGHTS_API_KEY`, `gh` | nothing |
| Extra steps | pattern table, which-pattern question, prior-triage check | none |

Pick local when the engineer just produced the failure or says "locally"; pick CI
when they name a test CI is failing. **When they said neither, don't ask -- look:**
run `collect-local-evidence.js --test '<what they named>'` (drop `--test` if they
named nothing), and take the local entry if it returns `ok` (that call *is* the
local entry's first step), the CI entry otherwise. **They compose** -- a local dig that needs a rate runs the history
query afterwards, and a CI diagnosis reproduces locally in the verification half.

**This is the debugging process for this case.** Don't layer a general debugging
workflow on top of it -- the rules below (one pattern at a time, a falsifiable
mechanism, evidence ruled in *and* out) are that discipline. If you arrived here
mid-way through another one, drop it and restart from the evidence; a hypothesis
formed before the evidence was read is the thing this skill exists to prevent.

**Not this skill:** a test still being written or edited (`author-e2e-tests`); a
whole run's failures or a run ID/URL (`e2e-failure-analyzer`); a Vitest or
extension-host failure.

## Non-negotiable rules

These hold on both entries unless a line names one.

- **Zero runs is never a clean result** (CI) -- only nonzero runs with no failure
  patterns is. **No local artifacts is not a dead end** (local) -- it means the
  test hasn't run yet, so it ends in an offer to run it.
- Resolve the test identity with `resolve-test-key.js`, never by hand; when it
  returns candidates instead of a resolution, **ask which test** before querying.
  The local entry needs this only to build a run command.
- Investigate **one** selected pattern at a time (CI); ask which when there's
  more than one. Never fetch evidence for a pattern the engineer didn't select --
  ask first, even to check a side theory about how patterns relate.
- Fetch **one** representative occurrence first; a second only for a listed
  reason in `references/evidence-escalation.md` -- name which.
- Agree the **fix approach** before the first edit, the same way you agree the
  pattern before fetching evidence.
- Escalate evidence only to answer a concrete question, one evidence block per
  step (below), and dispatch the read to a subagent. Keep large output on disk,
  not in the conversation.
- **Never** increase a timeout or add an arbitrary wait as the fix.
- **Never** claim a flaky test is fixed on one green run.
- A previous merged fix must be checked against subsequent failures, and that
  check reported as four lines, not a triage report (`references/prior-triage.md`).
- Root-cause claims cite observed evidence and the alternatives ruled out.
- Checkpoint at every phase transition (CI). The local entry checkpoints only
  once it escalates to a PR, an issue, or a `/clear`.

## Requirements

- **Claude Code**, run from a **Positron** checkout: the scripts resolve the repo
  root from their own location and keep triage state in the shared git dir.
- On PATH: `node` and `git`. The CI entry additionally needs `gh`
  (authenticated) and `unzip` -- neither is required by the local entry, which
  is why it also works on Windows, where there is no `unzip`.
- **CI entry only:** `E2E_INSIGHTS_API_KEY` set, or present in the repo-root `.env.e2e` (the query
  script falls back to it automatically). Get it from 1Password at
  `op://Positron/E2E_dashboard_api_key/credential`; without 1Password access, ask
  the Positron QA team. `triage-history.js` pre-flights this and exits with
  `cause: "missing-api-key"` plus the setup steps -- **relay those steps and stop;
  this is not a triage finding and there is no degraded mode.** A `cause:
  "api-unreachable"` is the different case: a key was found, so retry rather than
  sending the engineer to 1Password.
- Neighbor skills: `e2e-failure-analyzer` (its `e2e-query-history.js` and
  `e2e-process-s3.js` are invoked directly); at the fix stage
  `positron-pr-helper`, `author-vitest-tests`, `author-e2e-tests`.

## Scripts

Run from the repo root. Flags and output contracts:
[`references/scripts.md`](references/scripts.md). If a script itself breaks, see
[`references/script-fallbacks.md`](references/script-fallbacks.md).

| Script | Use it to |
|---|---|
| `resolve-test-key.js` | turn a title / spec path / spec:line / dashboard URL into the exact test key |
| `triage-history.js` | get the failure patterns (dual-branch, merged, one occurrence each) |
| `find-prior-triage.js` | check whether this spec was triaged before |
| `fetch-pattern-evidence.js` | pull evidence for one occurrence of the selected pattern (CI) |
| `collect-local-evidence.js` | build the same summary from this machine's `test-results/` (local) |
| `checkpoint.js` | start / resume / status; `--set phase=X` auto-derives `nextAction` |
| `record-diagnosis.js` | append the diagnosis block; it is what unblocks `phase=done` |

## Start or resume

`/debug-e2e-test "<test>"` -- start the **CI entry**. `<test>` can be
anything that names one test: a leaf title, a spec path, `spec.test.ts:41`, a
full `testName|||specPath` key, or a dashboard URL.
`/debug-e2e-test --local` -- start the **local entry** (see below).
`/debug-e2e-test` with **no argument** -- don't ask which test: run the local
collector unfiltered. It ranks failures first and newest first, so it selects the
most recent local failure on its own, and names it back to you for confirmation.
Only when that finds nothing (`no-results`) is there a test name to ask for.
`/debug-e2e-test --resume <triage-id>` -- resume.
`/debug-e2e-test --status` -- list saved triages.

**On `--local`** (or when the engineer describes a failure they just produced):
skip straight to evidence -- no key resolution, no history, no checkpoint.

```bash
node .claude/skills/debug-e2e-test/scripts/collect-local-evidence.js
```

Act on its `verdict`, then read `summaryFile` and go to **Determine root cause**.
[`references/local-evidence.md`](references/local-evidence.md) owns the verdict
table, the run-it offer for `no-results`, what local evidence cannot answer, and
when to start checkpointing after all. The rest of this section is the CI entry.

**On `--resume`:** run
`node .claude/skills/debug-e2e-test/scripts/checkpoint.js --triage-id <id> --read`,
validate it, and continue from `phase` / `nextAction`. Do **not** repeat
completed history or evidence work unless the engineer asks to refresh, the
saved data is invalid, or the branch/test identity changed.

**On `--status`:**
`node .claude/skills/debug-e2e-test/scripts/checkpoint.js --status`.

**Otherwise (new triage):**

1. Resolve the test identity. **Never hand-assemble the key** -- pass whatever the
   engineer gave you (leaf title, spec path, `spec.test.ts:41` from a stack trace,
   full key, or a pasted dashboard URL) straight through:
   ```bash
   node .claude/skills/debug-e2e-test/scripts/resolve-test-key.js '<whatever they gave>'
   ```
   It reads the real hierarchy from Playwright (~2s), so the `describe` nesting is
   never guessed. Use `resolved.testKey` when `resolved` is non-null; when it's
   null, **present `candidates` and ask which** -- do not pick one yourself. On
   `inWorkingTree: false` or a non-null `note`, relay it. If it exits non-zero,
   read [`references/history-query.md`](references/history-query.md#building-the-test-key).
2. Run the history helper:
   ```bash
   node .claude/skills/debug-e2e-test/scripts/triage-history.js \
     --test-key '<testName>|||<specPath>' --lookback-days 14
   ```
3. Act on its `verdict`. `stop: true` (`zero-runs-both`, `clean`) or an `error`
   field means stop and report -- read [`references/history-query.md`](references/history-query.md)
   for what each verdict means. Otherwise continue.
4. Initialize a checkpoint and record the patterns. **`<id>` is the `triageId`
   from the history output, used verbatim in every later command** -- inventing
   one silos the checkpoint from the work dir already holding the history and
   evidence, which is what `--resume` reads:
   ```bash
   node .claude/skills/debug-e2e-test/scripts/checkpoint.js --triage-id <id> \
     --init --test-key '<key>'
   ```
5. Check for prior triage before presenting the table:
   ```bash
   node .claude/skills/debug-e2e-test/scripts/find-prior-triage.js \
     --spec-path '<specPath>' --triage-id <id> \
     --occurrence-shas '["<sha1>","<sha2>"]'
   ```
   A non-`none` verdict changes the plan -- read [`references/prior-triage.md`](references/prior-triage.md).
   `none` is not conclusive -- it matches spec paths, so a POM/helper-only fix
   never registers. If the failing locator is gone from the working tree, read
   that file anyway.
   `open-attempt-in-flight` means stop and point at the open PR.
6. **Present the failure modes as a table** (never a run-on sentence). The Rate
   column comes from each pattern's `rates` array, never `count / totalRuns`;
   Last seen renders `lastSeen` as `5d ago (Jul 24)`, or just `today` at 0d.
   Include a "Seen on" column whenever two branches were queried:

   | # | Failure mode | Count | Rate | Last seen | Environments | Seen on |
   |---|---|---|---|---|---|---|
   | A | `locator.click` timeout: `.codicon-maximize` | 4 | 100% on feature/x | 5d ago (Jul 24) | ubuntu/chromium | feature/x only |
   | B | `toBeVisible()` timeout: `getByLabel('...')` | 3 | 1.9% on main | today | ubuntu/electron | main only |

   Count and Rate are cumulative over the lookback, so they cannot separate an
   acute burst a merged fix already closed from an ongoing drip. **A pattern whose
   `daysAgo` is stale next to the others is an already-fixed candidate: say so in
   your recommendation** instead of steering the engineer there on count alone.

   When `lastSeen.date` is `null` for every pattern, render Last seen as `unknown`
   and give the recency read from `onset` instead ("Started yesterday"). Report a
   dateless column as a gap in that one read, never as a reason the already-fixed
   question can't be asked.

7. **Ask which pattern to prioritize whenever the table has more than one row.**
   Give your own read ("A is dominant at 99% -- start there, or focus on B?")
   but let the engineer decide; they may already know which failure they care
   about. A single pattern needs no choice. Save the selection to the checkpoint (`--set
   selectedPattern=A --set phase=pattern-selected`).

## Investigate the selected pattern

**Local entry:** `collect-local-evidence.js` already wrote your `summary.md` --
start at step 2. Steps 2 and 3 are shared.

1. Fetch evidence for the pattern's representative occurrence:
   ```bash
   node .claude/skills/debug-e2e-test/scripts/fetch-pattern-evidence.js \
     --report-url '<representativeOccurrence.report_url>' \
     --triage-id <id> --pattern A
   ```
   (The helper strips the `index.html#?testId=` fragment and filters the report
   to this one test itself.)
2. Read the generated `summary.md` (failure, timeline tail, sibling tests,
   error-shaped logs, unresolved questions). **Read only the summary first.**
3. State the concrete questions that remain. **Before each escalation past the
   summary, show the evidence block** (`Question` / `Next artifact` / `Reason`)
   defined in [`references/evidence-escalation.md`](references/evidence-escalation.md)
   -- can't fill all three fields, don't escalate. **Show it, then dispatch the
   escalation as a subagent with that block as its prompt; don't open the
   artifact yourself, and don't let the block reach only the subagent.** That
   reference owns the block format, the dispatch contract, the ladder, the
   reasons a second occurrence is allowed, raw-log spelunking, and 403/null
   handling.
4. Save `phase=evidence-gathered` to the checkpoint.

## Determine root cause

This is a collaborative dig, not a rubber-stamped verdict. Read
[`references/triage-rubric.md`](references/triage-rubric.md) -- the taxonomy,
the dismissal bar, what each evidence type proves, and the locator-drift
decision.

State: the observed mechanism (citing trace step / log line / snapshot); what
the evidence rules **in and out**; the surviving alternatives; and a fix that
could plausibly change the failure rate (a fix that couldn't is not a fix --
keep digging).

**Delegate cross-file tracing to an `Explore` subagent** only after the evidence
names a concrete symbol / selector / event / subsystem -- under the same cap and
forbidden list as an evidence read ("Delegate the read" in
[`references/evidence-escalation.md`](references/evidence-escalation.md)).

**Then agree the fix approach, before the first edit.** Table the plausible fixes
(approach / what it changes / risk) with your recommendation and let the
engineer pick -- editing before the pick burns a context on a rejected
approach. Carry the pick as `diagnosis.fixApproach`.

Save the diagnosis to the checkpoint (`--patch` a `diagnosis` object) and set
`phase=hypothesis-ready`. Include the fields `record-diagnosis.js` renders
(`confidence`, `summary`, `targetedFailure`, `signal`, `hypothesis`, optional
`supersedes`) **plus `fixApproach` from the gate above** -- see
[`references/diagnosis-block.md`](references/diagnosis-block.md) for what each
must contain.

## Reproduce and fix

**Checkpoint the diagnosis before implementing, then set
`phase=implementation`.** That is the required step: history, evidence, and
working-tree edits are all durable on disk, so the invariant to hold is that
implementation *could* start from the checkpoint alone -- a `fixApproach`
specific enough to act on without re-reading the evidence.

That invariant is what makes a clear safe, so you never have to propose one: the
engineer clears when they want and `--resume <id>` picks the triage back up.

Read [`references/reproduction.md`](references/reproduction.md) now -- it owns
keeping this phase's context small, project choice, race verification, and the
RED bar
**you** must hold when `author-vitest-tests` writes a lower-level regression
test (that skill drives toward green; it does not enforce RED-first).

## Record the result and close out

Every triage ends by declaring an `outcome` and recording its diagnosis -- this
is not optional, and `checkpoint.js` refuses `phase=done` until it's satisfied.
**On the local entry there is no checkpoint to gate you**, so the rule is yours
to keep: a local dig that produces a PR or an issue still gets the block, which
means initializing the checkpoint at that point
([`references/local-evidence.md`](references/local-evidence.md)). A local dig
that ends with a fix and no artifact ends when the fix is verified -- say so and
stop; don't manufacture a checkpoint to close.
The outcome spans two axes (what you found x what you did):

| Outcome | Meaning | Where the block goes | To reach `done` |
|---|---|---|---|
| `fix-test` | test bug, fixed in a PR | the PR | `record-diagnosis.js --pr <n> --outcome fix-test` |
| `fix-product` | product bug, fixed in a PR | the PR | `record-diagnosis.js --pr <n> --outcome fix-product` |
| `file-issue` | product bug, filed not fixed | the new issue | `record-diagnosis.js --issue <n> --outcome file-issue` |
| `no-op` | not fixed and not filed (accepted flake, dup, backlog, handed off) | checkpoint only | `--set outcome=no-op --set outcomeReason="..."` |

`outcome` is the **primary** artifact -- a secondary *note* (e.g. mentioning a
product race in the backlog while you fix the test) does not change it. A second
*artifact* is different: see the split-outcome rule below.

**A returning sub-tool is not the end of the triage** -- opening the PR via
`positron-pr-helper` or a passing `author-vitest-tests` run resolves a *step*.
Once the PR/issue exists:

1. `record-diagnosis.js --triage-id <id> --pr <n> --outcome <fix-test|fix-product>`
   (or `--issue <n> --outcome file-issue`) appends the block and sets `outcome` +
   `outcomeRef` + `diagnosisBlockRecorded` in one call. For a `no-op`, skip this
   and `checkpoint.js --set outcome=no-op --set outcomeReason="..."` instead.
2. `checkpoint.js --set phase=done`.

**Split outcome (two artifacts).** When the root cause and a mitigation land
separately -- e.g. a product bug filed as an issue *plus* a fix PR -- the block
goes on **both**. Do step 1 for the primary (the artifact matching `outcome`),
then rerun `record-diagnosis.js --pr <n> --secondary` for the other: it appends
the block but won't repoint `outcomeRef`/`outcome`. `outcome` stays single.
