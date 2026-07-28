# triage-e2e-test scripts

Flags, behaviour, and output contracts for the helpers `SKILL.md` routes to.
Read this only when a script's compact output or a flag choice isn't obvious
from the SKILL step that invokes it; the normal path doesn't need it.

All scripts run from the repo root, emit **compact JSON to stdout**, and write
full payloads to the per-triage work directory under the shared git common dir
(`<git-common-dir>/triage-e2e-test/<id>/`), so `--resume` works from any
worktree. They wrap the `e2e-failure-analyzer` scripts rather than copying them.

Progress and diagnostics go to stderr; only the final JSON reaches stdout, so
piping through `jq` is safe.

## `triage-history.js`

Dual-branch history retrieval + merge.

```bash
node .claude/skills/triage-e2e-test/scripts/triage-history.js \
  --test-key '<testName>|||<specPath>' --lookback-days 14
```

| Flag | Default | Notes |
|---|---|---|
| `--test-key` | required | `testName|||specPath`; `testName` is the full hierarchical Playwright title |
| `--repo` | `positron` | test-health repo id |
| `--branch` | current branch | skips the git lookup |
| `--lookback-days` | `14` | 1-30 |
| `--occurrences-per-pattern` | `1` | widen to `2` only with a stated reason (see `references/evidence-escalation.md`) |
| `--triage-id` | derived from the test key | work-dir id |

Resolves the branch, queries the current branch and `main`, merges
`failure_patterns[]` by failure text (not array position), computes
counts/percentages/seen-on, classifies zero-run conditions, and selects one
representative occurrence per pattern.

Output: `{ testKey, triageId, branchSummary, patterns[], verdict, summaryFile,
rawResultFile }`. Each pattern carries a `rates` array (per branch, scoped to
the environments it occurred in) and a `representativeOccurrence`.
`testDetailViewUrl` is the dashboard link `record-diagnosis.js` embeds.

**`triageId` in the output is the id every later script must use.** Exit 1 with
`{ error }` when a branch query returns `{}` (API down or `E2E_INSIGHTS_API_KEY`
unset) -- never read that as "no failures". Verdict meanings are in
`references/history-query.md`.

## `find-prior-triage.js`

Filtered prior-triage lookup.

```bash
node .claude/skills/triage-e2e-test/scripts/find-prior-triage.js \
  --spec-path '<specPath>' --triage-id <id> \
  --occurrence-shas '["<sha1>","<sha2>"]'
```

Finds PRs whose body names this spec path, extracts the recorded diagnosis
fields, resolves merge SHAs, and partitions occurrence SHAs into
`beforeFixShas` / `afterFixShas` / `unknownShas` by git ancestry (fetching when
a SHA isn't local). Verdict meanings and how to act on them are in
`references/prior-triage.md`.

## `fetch-pattern-evidence.js`

Summary-first evidence for one occurrence.

```bash
node .claude/skills/triage-e2e-test/scripts/fetch-pattern-evidence.js \
  --report-url '<representativeOccurrence.report_url>' \
  --triage-id <id> --pattern A
```

Strips the `index.html#?testId=` fragment from the URL, runs the S3 processor
filtered to this one test, stores the full evidence on disk, and generates a
compact `summary.md` (failure, timeline tail, sibling tests, error-shaped log
lines, unresolved questions).

`--keep-raw-logs` leaves the raw `logs-<shortId>.zip` in the OS temp dir and
prints the path to stderr on its last line -- the Level 4 path in
`references/evidence-escalation.md`. A 403 means that upload isn't fetchable
(in flight or expired), not that no evidence exists.

## `checkpoint.js`

Durable state for start / resume / status.

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> --init --test-key '<key>'
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> --read
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> --set phase=pattern-selected --set selectedPattern=A
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> --patch '{"diagnosis":{...}}'
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --status
```

Phases: `awaiting-pattern-selection`, `pattern-selected`, `evidence-gathered`,
`hypothesis-ready`, `awaiting-clear`, `implementation`, `done`.

**`--set phase=X` auto-derives `nextAction`** from that phase, so a resume
always prints the right next step. Pass `--set nextAction=...` only to override
the derived value.

**`phase=done` is gated.** It refuses to persist until an `outcome` is set and,
for PR/issue outcomes, `diagnosisBlockRecorded` is true -- the mechanical guard
against calling a triage done before the diagnosis block lands. `--validate`
checks the saved state without mutating it.

## `record-diagnosis.js`

Renders the `### E2E Triage Diagnosis` block from the checkpoint `diagnosis`
object plus the test title / dashboard URL / frequency pulled from history, and
appends it to the resolving artifact. Idempotent.

```bash
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js --triage-id <id> --pr <n> --outcome fix-test
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js --triage-id <id> --issue <n> --outcome file-issue
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js --triage-id <id> --pr <n> --secondary
node .claude/skills/triage-e2e-test/scripts/record-diagnosis.js --triage-id <id> --pr <n> --outcome fix-test --dry-run
```

- Sets `outcome`, `outcomeRef`, and `diagnosisBlockRecorded` in one call. It is
  the **only** writer of `diagnosisBlockRecorded`, so it is what unblocks
  `phase=done`.
- **Opening a PR via `positron-pr-helper` does NOT record the block** -- run
  this afterwards.
- `--secondary` appends the block to a second artifact without repointing
  `outcomeRef`/`outcome` (the split-outcome case in `SKILL.md`).
- `--dry-run` previews the rendered block without touching the artifact.
- Field requirements are validated before rendering; what each field must
  contain is in `references/diagnosis-block.md`.

## Tests

```bash
node --test .claude/skills/triage-e2e-test/scripts/test/*.test.js
```
