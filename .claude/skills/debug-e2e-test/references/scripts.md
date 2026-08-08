# Scripts -- flags and output contracts

Reference for the seven helpers in `scripts/`. Read it when you need a flag that
the SKILL's workflow steps don't already spell out, or when you need to know what
a script's output actually contains. If a script is *broken* and you need to do
its work by hand, that is [`script-fallbacks.md`](script-fallbacks.md) instead.

## Shared conventions

- **Run from the repo root**, as `node .claude/skills/debug-e2e-test/scripts/<name>.js`.
- **stdout is compact JSON only.** Large payloads (full API responses, processor
  output, trace timelines) are written to disk and referenced by path, so they
  never enter the conversation.
- **Errors are structured**: `{ "error": "..." }` on stdout plus a non-zero exit.
  Treat that as stop-and-surface, never as "no data" or a cue to fall back to a
  broader search.
- **Work directory**: `<git-common-dir>/debug-e2e-test/<triage-id>/`. It is
  anchored on the git *common* dir, so a triage started in one worktree resumes
  from any other. Outside a git repo it falls back to
  `.claude/work/debug-e2e-test/`.
- **`--triage-id`** is the same value everywhere. `triage-history.js` derives it
  (`<leaf-test-slug>-<hash8>`) and returns it as `triageId`; pass that verbatim to
  every later script. Inventing one splits the checkpoint from the work dir
  holding the history and evidence, which is what `--resume` reads.

## `resolve-test-key.js`

Turns a loose test reference into an exact `testName|||specPath` key by reading
the hierarchy from `npx playwright test --list` (~2s, all projects, deduped --
the key has no project dimension). Takes the input as a leading positional or
`--input`; no other flags.

| Input shape | `mode` | Behavior |
|---|---|---|
| `Suite > test\|\|\|test/e2e/...ts` | `exact-key` | validated against the tree, passed through either way |
| dashboard test-detail URL | `dashboard-url` | decodes the `test` query param |
| `test/e2e/tests/x.test.ts` or `x.test.ts` | `spec-path` | every test in the file; resolves only if the file has exactly one |
| `x.test.ts:41` | `spec-line` | the test at that line, else the nearest declared above it |
| any other text | `title-search` | exact full title, then exact leaf, then substring (case-insensitive) |

Output: `{ input, mode, resolved, candidates, totalListed, inWorkingTree, note }`.

- **`resolved`** non-null -> use `resolved.testKey`. Fields: `testKey`, `testName`,
  `specPath`, `line`, `leaf`.
- **`candidates`** non-empty with `resolved: null` -> ambiguous, capped at 15.
  Present them and ask; never pick one silently.
- **`inWorkingTree: false`** -> the key isn't in the tree (renamed or deleted
  test). Still resolved, because CI history outlives the source; relay the `note`.
- Non-zero exit: no match, an empty input, a URL with no `test` param, or a
  listing failure. A listing failure with an exact key given is *not* fatal -- the
  key is emitted with a `note` instead, since it needs no working tree.

## `triage-history.js`

Dual-branch failure history: queries the current branch and `main`, merges
`failure_patterns[]` by normalized failure text, and picks one representative
occurrence per pattern.

| Flag | Default | Notes |
|---|---|---|
| `--test-key <key>` | *required* | `testName\|\|\|specPath` |
| `--repo <id>` | `positron` | test-health repo id |
| `--branch <branch>` | current git branch | skips the git lookup; `main` means only main is queried |
| `--lookback-days <n>` | `14` | 1-30 |
| `--occurrences-per-pattern <n>` | `1` | raise to `2` only for a listed escalation reason |
| `--triage-id <id>` | derived from the test key | |

**Output:** `{ triageId, testKey, testName, specPath, testDetailViewUrl,
branchSummary, patterns[], onset, verdict, stop, note, lookbackDays, queriedAt,
rawResultFile, summaryFile }`.

- `onset` is the API's own coarse recency read: `{ type, label, value,
  firstFailureSha }` (e.g. `Started` / `yesterday`). It is independent of
  per-occurrence dates, so it still answers "is this current?" when every
  `lastSeen.date` is `null`.

Each `patterns[]` entry: `{ id, failure, count, rates[], environments[], seenOn,
lastSeen, representativeOccurrence }`.

- `rates[]` is per branch: `{ branch, count, environmentRuns, ratePercent }`.
  `environmentRuns` is scoped to the environments the pattern actually occurred
  in, which is why the table's Rate column reads from `rates` and never from
  `count / totalRuns`.
- `lastSeen` is `{ date, daysAgo, sha }`, any of which may be `null` -- see
  [`history-query.md`](history-query.md#how-lastseen-is-derived).
- `id` is a spreadsheet-style label: `A`..`Z`, then `AA`, `AB`, ...

Also writes `history-summary.json` and `history-raw.json` to the work dir.
`checkpoint.js --init` auto-seeds `history` + `patterns` from that summary file.

Verdicts (`ok`, `ok-current-branch-new`, `zero-runs-both`, `clean`) are explained
in [`history-query.md`](history-query.md).

## `find-prior-triage.js`

Searches PRs carrying an `E2E Triage Diagnosis` block, keeps the ones whose body
names this spec path, and partitions the supplied occurrence SHAs by git ancestry
against each merged fix.

| Flag | Default | Notes |
|---|---|---|
| `--spec-path <path>` | *required* | exact spec path from the test key |
| `--occurrence-shas <json>` | `[]` | JSON array; **omitting it forces the `too-recent-to-tell` verdict** (nothing to check ancestry against) |
| `--repo <owner/repo>` | `posit-dev/positron` | |
| `--triage-id <id>` | none | needed for the on-disk `prior-triage-raw.json` |
| `--limit <n>` | `50` | PR search limit |

**Output:** `{ specPath, openAttempts[], mergedAttempts[], verdict,
rawResultFile }`. Verdict meanings and how to act on them:
[`prior-triage.md`](prior-triage.md).

## `fetch-pattern-evidence.js`

Runs the S3 report processor for **one** occurrence of **one** pattern, filtered
to the test under triage, and prints a manifest instead of the multi-megabyte
payload.

| Flag | Default | Notes |
|---|---|---|
| `--report-url <url>` | *required* | the pattern's `representativeOccurrence.report_url`; the `index.html#?testId=` fragment is stripped for you and the testId reused as the filter |
| `--triage-id <id>` | *required* | |
| `--pattern <id>` | `A` | names the evidence sub-directory |
| `--title <full title>` | none | filter fallback when the URL carries no `testId` |
| `--test-id <id>` | none | explicit testId filter |
| `--keep-raw-logs` | off | extracts the raw logs into `<evidenceDir>/raw-logs/`. Without it the processor cleans up its temp extract, so escalating to raw logs means refetching with the flag |
| `--occurrence <label>` | none | nests artifacts under `evidence/<pattern>/<label>` so several occurrences of one pattern can coexist. Use it whenever you fetch a second occurrence |

**Output:** `{ evidenceDir, summaryFile, timelineFile, snapshotFile,
screenshots[], rawLogDir, rawLogsRetained, rawEvidenceFile, failure }`. Paths
are repo-relative; `timelineFile` and `snapshotFile` may be `null`.

The evidence dir is keyed by **pattern**, not by occurrence, so each fetch clears
the artifacts it owns first. Otherwise a previous occurrence's `raw-logs/`
survives and reads as the current one's. Trust `rawLogsRetained` over the
presence of a `raw-logs/` directory.

**Read `summaryFile` first**, and open anything else only under the gate in
[`evidence-escalation.md`](evidence-escalation.md).

## `collect-local-evidence.js`

The local entry's counterpart to `fetch-pattern-evidence.js`: walks this
machine's Playwright output instead of a CI report, and writes the same
`summary.md` shape. Procedure and verdict handling:
[`local-evidence.md`](local-evidence.md).

| Flag | Default | Notes |
|---|---|---|
| `--results-dir <dir>` | `test-results` | Playwright's output dir, repo-relative |
| `--logs-dir <dir>` | `test-logs` | app/kernel logs; a *different* root from the results dir |
| `--test <substring>` | none | filters on the result directory name |
| `--dir <exact>` | none | pins one result directory (use after an `ambiguous` verdict) |
| `--list` | off | show the candidates and exit without collecting |
| `--triage-id <id>` | none | write into that triage's `evidence/local/` instead of a standalone dir; only needed once a checkpoint exists |

**Output:** `{ verdict, resultsDir, candidates[], selected, evidenceDir,
summaryFile, timelineFile, snapshotFile, screenshots[], logDir, failure,
nextStep }`.

- **`verdict`** is `ok` | `no-results` | `no-failure` | `ambiguous`; `nextStep`
  carries the matching instruction. `no-results` and `no-failure` are different
  states -- local runs retain traces for passing tests, so artifacts existing
  proves nothing about whether anything failed.
- **`--test` takes a fragment or the full title**; both resolve against Playwright's
  hyphenated, middle-truncated directory names.
- **Failure is detected from `error-context.md`**, which Playwright writes only
  for a failed test. Never from the trace's presence.
- A `no-failure` run that *has* a trace is still collected, flagged as passing --
  that trace is the only way to diff a green ordering against a red one locally
  (`retries: 0` off CI means there is no attempt pair).

## `checkpoint.js`

Durable triage state at `<work-dir>/state.json`.

| Invocation | Does |
|---|---|
| `--triage-id <id> --init --test-key <key> [--branch b] [--lookback-days n] [--phase p] [--force]` | create state; auto-seeds `history`/`patterns` from `history-summary.json` if present. Refuses to clobber an existing checkpoint without `--force` |
| `--triage-id <id> --read` | print state (plus `_validation` when invalid) |
| `--triage-id <id> --validate` | print `{ ok, errors[], phase, nextAction }` only |
| `--triage-id <id> --set key=value` | set one scalar; repeatable |
| `--triage-id <id> --patch '<json>'` | deep-merge an object |
| `--triage-id <id> --patch-pattern <id> --patch '<json>'` | merge into exactly one `patterns[]` entry |
| `--status` | list every saved triage |

- **`--set` accepts only** `phase`, `nextAction`, `selectedPattern`,
  `lookbackDays`, `branch`, `outcome`, `outcomeRef`, `outcomeReason`,
  `diagnosisBlockRecorded`. Object fields go through `--patch`.
- **`--patch` rejects unknown top-level keys.** `--patch '{"confidence":"high"}'`
  fails loudly rather than creating a stray top-level field the renderer never
  reads; nest it (`{"diagnosis":{"confidence":"high"}}`).
- **`--patch` replaces arrays wholesale.** To annotate one pattern without
  resending the rest, use `--patch-pattern`.
- **Setting `phase` derives `nextAction`** unless `nextAction` is set in the same
  call.
- **`--init --phase <p>`** starts somewhere other than `awaiting-pattern-selection`.
  The local entry uses `--phase evidence-gathered` when it escalates: it never
  selected a pattern, and replaying phases it skipped would print misleading next
  actions. `done` is rejected -- that transition goes through the outcome gate.
- **Phases**, in order: `awaiting-pattern-selection`, `pattern-selected`,
  `evidence-gathered`, `hypothesis-ready`, `awaiting-clear`, `implementation`,
  `done`. `awaiting-clear` is vestigial -- accepted on read so in-flight
  checkpoints still validate, never routed to.
- **`phase=done` is gated.** It requires an `outcome`; `no-op` additionally
  requires `outcomeReason`, and every other outcome requires `outcomeRef` plus
  `diagnosisBlockRecorded=true` (only `record-diagnosis.js` sets that flag). A
  blocked write fails with `{ error, gate }` and does not persist.

## `record-diagnosis.js`

Renders the `E2E Triage Diagnosis` block from the checkpoint's `diagnosis` object
plus the test title / dashboard URL / frequency pulled from `history-summary.json`,
and appends it to a PR or issue.

| Flag | Default | Notes |
|---|---|---|
| `--triage-id <id>` | *required* | |
| `--pr <n>` / `--issue <n>` | one required unless `--dry-run` | |
| `--repo <owner/repo>` | `posit-dev/positron` | |
| `--outcome <o>` | none | `fix-test` \| `fix-product` \| `file-issue`; `no-op` goes through `checkpoint.js` |
| `--secondary` | off | append to a supplementary artifact without repointing `outcome`/`outcomeRef`; cannot be combined with `--outcome` |
| `--dry-run` | off | render and print only; touches neither the artifact nor the checkpoint |

**Output:** `{ block, target, alreadyPresent, recorded, outcome }`.

- **Idempotent**: a body already containing the block heading is left alone and
  the flag is re-affirmed.
- **Validates before rendering**: `diagnosis.confidence` must be
  `high|medium|low`, and `diagnosis.summary` must be a non-empty single line under
  600 chars. Other fields render as `n/a` when missing rather than failing, so
  `--dry-run` is the way to catch a thin block.
- Always writes `diagnosis-block.md` to the work dir, `--dry-run` included.

Field-by-field guidance: [`diagnosis-block.md`](diagnosis-block.md).
