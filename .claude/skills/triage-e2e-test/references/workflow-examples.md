# Workflow examples -- reference

Two end-to-end runs, written for **maintainers of this skill** rather than for a
live triage. They exist so a change to a script's flags or the phase sequence can
be checked against a concrete trace. Nothing here is a new rule; the SKILL and the
other references remain authoritative if this file ever disagrees with them.

Values (`<id>`, PR numbers, failure text) are illustrative. Engineer-facing turns
are elided to `>` lines -- the checkpoints they gate are the point.

## Shape of the whole thing

```text
resolve-test-key.js -- candidates, no resolved --> ASK which test
   |  resolved
triage-history.js ---- verdict: zero-runs-both / clean --> STOP
   |  ok
checkpoint.js --init            (phase=awaiting-pattern-selection)
   |
find-prior-triage.js -- verdict: open-attempt-in-flight --> STOP
   |  none / recurred-after-fix / fix-holding / too-recent-to-tell
present failure table --> ASK which pattern      (phase=pattern-selected)
   |
fetch-pattern-evidence.js --> read summary.md    (phase=evidence-gathered)
   |            ^
   |            +-- escalate only behind the evidence block
reason to a mechanism --> ASK which fix approach (phase=hypothesis-ready)
   |
checkpoint the diagnosis                         (phase=implementation)
   |            ^
   |            +-- optional: OFFER awaiting-clear -> /clear -> --resume
   |
reproduce + verify, open the PR / issue
   |
record-diagnosis.js --> checkpoint.js --set phase=done
```

## Example 1 -- single pattern, test bug, one PR

A stale selector, no prior triage, no re-clear needed.

```bash
# 0. Resolve whatever the engineer said into the exact key. Here they only had
#    the leaf title, and it is unique, so it resolves without a question.
node .claude/skills/triage-e2e-test/scripts/resolve-test-key.js 'can save a plot'
# -> { "mode": "title-search", "resolved": { "testKey": "Plots > Python Plots > can
#      save a plot|||test/e2e/tests/plots/plots.test.ts", "line": 61 },
#      "candidates": [], "inWorkingTree": true, "note": null }

# 1. History. triageId comes back in the output; reuse it verbatim.
node .claude/skills/triage-e2e-test/scripts/triage-history.js \
  --test-key 'Plots > Python Plots > can save a plot|||test/e2e/tests/plots/plots.test.ts' \
  --lookback-days 14
# -> { "triageId": "can-save-a-plot-3f2a91c4", "verdict": "ok",
#      "patterns": [ { "id": "A", "count": 6, "rates": [ ... ] } ], ... }

# 2. Checkpoint. --init auto-seeds history + patterns from history-summary.json.
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id can-save-a-plot-3f2a91c4 --init \
  --test-key 'Plots > Python Plots > can save a plot|||test/e2e/tests/plots/plots.test.ts'

# 3. Prior triage, before presenting the table.
node .claude/skills/triage-e2e-test/scripts/find-prior-triage.js \
  --spec-path 'test/e2e/tests/plots/plots.test.ts' \
  --triage-id can-save-a-plot-3f2a91c4 \
  --occurrence-shas '["a1b2c3d","e4f5g6h"]'
# -> { "verdict": "none" }
```

> One pattern only -- no selection question. Present the table, note that, move on.

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id can-save-a-plot-3f2a91c4 \
  --set selectedPattern=A --set phase=pattern-selected

# 4. Evidence for the one representative occurrence.
node .claude/skills/triage-e2e-test/scripts/fetch-pattern-evidence.js \
  --report-url 'https://d1abc.cloudfront.net/run-4821/index.html#?testId=9f3c' \
  --triage-id can-save-a-plot-3f2a91c4 --pattern A
# -> { "summaryFile": ".../evidence/A/summary.md", "snapshotFile": ".../error-context.md", ... }
```

Read `summary.md` only. It leaves one concrete question -- did the button ever
render? -- so **one** escalation is licensed, and it gets the block first:

```text
Evidence Level 3 (Page snapshot)

Question:
Is the save control present in the DOM under a different role than
`getByRole('button', { name: 'Save' })` expects?

Next artifact:
error-context page snapshot

Reason:
The timeline shows the locator never resolved, which cannot distinguish a
never-rendered control from a renamed one.
```

The snapshot shows `Save plot` as the accessible name -- identifier present under
a different shape, so this is locator drift per the rubric.

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id can-save-a-plot-3f2a91c4 --patch '{
    "diagnosis": {
      "confidence": "high",
      "summary": "Save-plot button was renamed; the POM selector still matches the old accessible name",
      "targetedFailure": "locator.click timeout: getByRole(\"button\", { name: \"Save\" })",
      "signal": "Snapshot at failure shows the control present with accessible name \"Save plot\"; the timeline shows the locator never resolved",
      "hypothesis": "test code -- locator drift",
      "fixApproach": "update the accessible name in the plots page object"
    } }' \
  --set phase=hypothesis-ready
```

> Fix approach agreed before the first edit.

Deterministic failure, so it reproduces directly and the context stays small
enough to skip the re-clear:

```bash
npx playwright test test/e2e/tests/plots/plots.test.ts \
  --project e2e-electron --grep 'can save a plot'
```

Fix the page object, confirm the same run passes, open the PR (`positron-pr-helper`),
then -- **the PR existing is not the end** -- record and close:

```bash
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js \
  --triage-id can-save-a-plot-3f2a91c4 --pr 15240 --dry-run   # preview
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js \
  --triage-id can-save-a-plot-3f2a91c4 --pr 15240 --outcome fix-test
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id can-save-a-plot-3f2a91c4 --set phase=done
```

## Example 2 -- recurred-after-fix, product race, split outcome

Two patterns, a prior fix that didn't hold, a re-clear, and two artifacts.

```bash
node .claude/skills/triage-e2e-test/scripts/triage-history.js \
  --test-key 'Console > R Console > restarts cleanly|||test/e2e/tests/console/console-restart.test.ts'
# -> verdict "ok", patterns A (count 9, lastSeen 11d ago) and B (count 4, lastSeen today)

node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 --init --test-key '<same key>'

node .claude/skills/triage-e2e-test/scripts/find-prior-triage.js \
  --spec-path 'test/e2e/tests/console/console-restart.test.ts' \
  --triage-id restarts-cleanly-77bd10e2 \
  --occurrence-shas '["11aa22b","33cc44d","55ee66f"]'
# -> { "verdict": "recurred-after-fix",
#      "mergedAttempts": [ { "number": 15102, "afterFixShas": ["55ee66f"], ... } ] }
```

Lead with that. A's occurrences all predate #15102 and its `lastSeen` is stale --
say so in the recommendation instead of steering toward A on its higher count.

> Two rows, so the choice is the engineer's. They pick B.

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 \
  --set selectedPattern=B --set phase=pattern-selected

node .claude/skills/triage-e2e-test/scripts/fetch-pattern-evidence.js \
  --report-url '<B.representativeOccurrence.report_url>' \
  --triage-id restarts-cleanly-77bd10e2 --pattern B
```

The summary mines no error-shaped lines -- expected for a race, which is
invisible in an error digest by construction. The question is ordering, so it
goes straight to Level 4:

```bash
node .claude/skills/triage-e2e-test/scripts/fetch-pattern-evidence.js \
  --report-url '<same url>' --triage-id restarts-cleanly-77bd10e2 \
  --pattern B --keep-raw-logs
```

Diffing attempt 0 (failed) against attempt 1 (passing retry) in the same
supervisor channel file shows the `Ready` message landing before the websocket
reconnect only in the failing attempt -- an ordering, i.e. a named mechanism
rather than a restated timeout.

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 --patch '{
    "diagnosis": {
      "confidence": "medium",
      "summary": "Supervisor emits Ready before the client reconnects, so the frontend never leaves Starting",
      "targetedFailure": "toBeVisible() timeout: getByText(\"R 4.4.1\")",
      "signal": "Attempt 0 logs Ready at 12:04:03.114 before the websocket reopen at 12:04:03.402; attempt 1 reverses the order",
      "hypothesis": "product race",
      "supersedes": "#15102 (hypothesized a POM wait was too early, recurred 1 time after merge)",
      "fixApproach": "file the supervisor race; harden the POM to await the session-state signal as a mitigation"
    } }' \
  --set phase=hypothesis-ready

# The diagnosis is durable on disk, so a clear is safe here -- this one was an
# evidence-heavy dig, so offer it. Skip straight to phase=implementation if the
# engineer would rather keep the thread.
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 --set phase=awaiting-clear
```

> "That was a long evidence dig -- want me to `/clear` and resume from the
> checkpoint before implementing, or keep the context?" On yes: `/clear`, then
> `/triage-e2e-test --resume restarts-cleanly-77bd10e2`.

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 --read
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 --set phase=implementation
```

The race lives below the e2e layer, so the regression test is a Vitest one via
`author-vitest-tests` -- and the RED bar is this skill's to hold: it must fail
*inside the assertion*, on the diagnosed ordering, before the fix.

File the product issue, open the mitigation PR, then record the block on **both**.
The issue is the primary artifact (it matches `outcome`), so it goes first:

```bash
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js \
  --triage-id restarts-cleanly-77bd10e2 --issue 15251 --outcome file-issue
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js \
  --triage-id restarts-cleanly-77bd10e2 --pr 15252 --secondary
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id restarts-cleanly-77bd10e2 --set phase=done
```

Report the local result literally -- "8/8 passed locally; the CI contention that
surfaces this wasn't recreated" -- never "confirmed fixed."

## Example 3 (sketch) -- the no-op close-out

Not every triage produces an artifact. A pattern that turns out to duplicate an
open issue ends without `record-diagnosis.js`, and the done-gate demands a reason
instead of a ref:

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js \
  --triage-id <id> --set outcome=no-op \
  --set outcomeReason="duplicate of #14983; pattern matches its RPC race exactly"
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> --set phase=done
```
