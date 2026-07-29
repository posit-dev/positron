# Evidence escalation -- reference

`fetch-pattern-evidence.js` gives you Level 1-2 for one occurrence: a compact
manifest plus a deterministic `summary.md` (failure, timeline tail, sibling
tests, error-shaped log lines, unresolved questions). **Escalate past the
summary only to answer a concrete question it raised**, and stop as soon as the
mechanism is clear -- every artifact you open stays in context for every turn
that follows.

## The gate

Before **each** step past Level 2, emit the evidence block -- the level and the
artifact you are about to open as a scannable heading, then three fields:

```text
Evidence Level 4 (Raw logs)

Question:
Did the execute request ever reach the kernel?

Next artifact:
Raw logs -- Quarto extension channel and Python kernel log

Reason:
The timeline records command dispatch but not extension-level execution or
kernel messages.
```

Name the artifact, not a description of the step -- `(Page snapshot)`,
`(Timeline)`, `(Raw logs)`, `(Screenshot)`, `(Second occurrence)`; if a step
opens several, pick the one the question turns on. `Reason` names the gap in the
evidence you already have -- for a second occurrence, that gap is the listed
reason you are invoking. The same block goes on every escalation: it is
structured diagnostic metadata a reader scans, not narration.

If any of the three fields can't be filled, the escalation isn't justified --
reason from what you already have, or say what you'd need and stop. "To be
thorough", "to confirm", and "to get more context" are not questions; a question
names a fact whose two possible values would change the diagnosis.

## The escalation ladder

1. **History summary** (`triage-history.js`) -- identify active patterns. Do not
   fetch reports for unselected patterns.
2. **Compact processed evidence** (`fetch-pattern-evidence.js` -> `summary.md`)
   -- one representative occurrence for the selected pattern. Read the summary
   only.
3. **One specific artifact** -- open the full `timelineFile`, the `snapshotFile`
   (error-context page snapshot), or a source file, only when Level 2 raises a
   concrete unresolved question. **A `screenshot` is the most expensive artifact
   on the ladder** (~20k tokens, 10-20x a `timelineFile`) and the last to reach
   for: prefer `snapshotFile`, which is text and says what the DOM actually
   contained. Open one frame -- the moment of failure, per the manifest -- only
   for a genuinely visual question (layout, overlay, z-order) the snapshot and
   timeline cannot answer, write down what you saw, and never re-read it.
4. **Raw logs** -- read only when the issue depends on sequence/ordering,
   missing output, extension-channel behavior, or process termination -- a
   detail absent from processed evidence (see "raw logs" below).
5. **Additional occurrence** -- fetch a second **only** for one of these five
   reasons, and name which one in the block's `Reason`:
   1. validate repeatability of the mechanism,
   2. test a race hypothesis,
   3. investigate same-file adjacency,
   4. reconcile evidence that conflicts between occurrences,
   5. check whether a previous fix held.

   Re-run `fetch-pattern-evidence.js` with a different occurrence's `report_url`
   (widen `--occurrences-per-pattern 2` on `triage-history.js` first to get a
   second `report_url`). Anything outside these five is not a reason -- a
   retrieval failure (403 / `report_url: null`) is a *substitution* for the
   first occurrence, not an escalation, and doesn't need one.

## Why the summary can't see everything

The mined log excerpt greps for **error-shaped lines only** (`no such file`,
`traceback`, `\w+error:`, `failed to \w+`, etc. -- see `LOG_ERROR_RE` in
`e2e-process-s3.js`). It cannot show sequence or timing: `[info]`-level lines
never match, so a **race** (two things in the wrong order, neither erroring on
its own) is invisible in the digest by construction. Any time the question is
"what happened, in what order" rather than "what error was thrown," go straight
to the raw logs (Level 4).

## Reading raw logs (Level 4)

The S3 report is the complete source -- it keeps each attempt (attempt 0 = the
failure). Do **not** hand-download a GitHub Actions artifact zip to get app-side
logs: with CI `retries=1`, a flaky test's per-test logs
(`server/.../positron.positron-supervisor/*.log`, kernel logs) are overwritten by
the passing retry in the artifact, so it shows a *clean* run and will mislead you
into thinking the failing logs are gone. `--keep-raw-logs` on the report is the
path to the failing kernel/supervisor logs; never escalate to a ci-arm repro just
to recapture logs the report already has.

Re-run `fetch-pattern-evidence.js` with `--keep-raw-logs`, or the underlying
processor without `--cleanup`. The raw `logs-<shortId>.zip` is left in the OS
temp dir, at the path the script prints to stderr on its last line:
`(temp dir kept at /var/folders/.../T/e2e-process-s3-<hash> -- ...)`.

Each extension's real output channel is its own file under
`server/exthost2/<extension-id>/*.log` (e.g.
`ms-python.python/Python Language Pack.log`), separate from the top-level
`e2e-test-runner.log` the digest draws from. Read the **full channel file**, not
just matched lines -- the multi-step sequence (activate, create, cancel,
reconnect) needed to see what actually happened often has no error line at all.

```bash
# TMP is the exact path the script printed.
LZ=$(find "$TMP" -name 'logs-*.zip' | head -1)
mkdir -p <scratch>/logs && unzip -o "$LZ" -d <scratch>/logs
find <scratch>/logs -iname '*<extension-id-or-keyword>*'
```

To slice the raw processor JSON instead of reading the whole dump, pipe through
`jq` (progress goes to stderr, only final JSON hits stdout):

```bash
node .claude/skills/e2e-failure-analyzer/scripts/e2e-process-s3.js ... \
  | jq '.testDetails[0].attempts[0].trace.timeline'
```

## Contrast the failing attempt against a passing one

For a suspected race, the digest shows *what* failed but not *which
interleaving* separates pass from fail. The S3 report retains every attempt
(attempt 0 = the failure; later attempts = passing retries), so a green run's
logs are already in the same report -- no second fetch, no ci-arm. Diff the two
attempts' `[info]`-level orderings in the same channel file (e.g. the kernel /
supervisor log): the line whose relative order flips between them is the race,
and the direction of the flip tells you which ordering is the bug. This turns an
"is it even a race" hunch into a named mechanism -- it's what separates a Signal
that cites an ordering from one that only restates the timeout.

## Retrieval failures

- **403 from the processor** means "this particular upload isn't fetchable"
  (still in flight, or expired), not "no evidence exists." `fetch-pattern-
  evidence.js` surfaces this as an error -- fall through to the next
  occurrence's `report_url` for the same pattern.
- **`report_url: null`** on an occurrence -- state it explicitly (e.g. "3 of 8
  occurrences have no report available") rather than assuming the reports that
  do exist fully cover the pattern.
