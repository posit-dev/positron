# Evidence escalation -- reference

`fetch-pattern-evidence.js` gives you Level 1-2 for one occurrence: a compact
manifest plus a deterministic `summary.md` (failure, timeline tail, sibling
tests, error-shaped log lines, unresolved questions). **Escalate past the
summary only to answer a concrete question it raised**, and stop as soon as the
mechanism is clear -- every artifact you open stays in context for every turn
that follows.

## The gate

Before each escalation beyond Level 2, emit an evidence block:

```text
Evidence Level 4 (Raw logs)

Question:
Did the execute request ever reach the kernel?

Next artifact:
Quarto extension channel
Python kernel log

Reason:
The timeline records command dispatch but not extension-level execution or
kernel messages.
```

Use the heading to identify the evidence level and primary artifact category:
(Page snapshot), (Timeline), (Raw logs), (Screenshot), or
(Second occurrence). If several artifacts are opened, name the one the
question depends on.

Reason identifies why the current evidence cannot answer the question. For a
second occurrence, state the reason that justifies comparing another run.

Show this block in the conversation for every escalation beyond Level 2, before
you act on it. It is structured diagnostic metadata rather than narration, and
it is the one moment the engineer can redirect the read before it is paid for --
so a block that only reaches a subagent has been lost.

Do not escalate unless all three fields can be completed. Otherwise, reason from
the current evidence or state what evidence is missing and stop.

"To be thorough", "to confirm", and "to get more context" are not valid
questions. A valid question identifies a fact whose possible answers would
change the diagnosis.

## Delegate the read

Everything you read once, to answer one question, goes to an `Explore` subagent
-- an artifact you open stays in your context for every turn after, and its
answer is a line or two. Both dispatches below share one forbidden list: no full
file contents, no repo tour, no fix suggestion, no speculation past what was
read.

**Evidence artifacts (Levels 3-5).** The shown block *is* the prompt: pass the
same three fields plus the artifact path -- a copy of what you just showed, never
a substitute for showing it -- and require back

- the direct answer to `Question`, or "cannot be answered from this artifact";
- **verbatim** excerpts with timestamps, <=20 lines total -- never a paraphrase;
- anything surprising adjacent to what it was asked about.

The third bullet is not optional. The decisive line is often one you weren't
looking for -- an `[info]` at the right timestamp -- and a subagent answering
only the literal question will drop it.

**Then show the engineer the excerpt, not just your conclusion.** Quote the
returned lines (trimmed to what bears on the question) in the same turn you
report the answer. You have the artifact and they don't, so a bare "confirmed"
asks them to trust a read they cannot check -- and this is a collaborative dig
precisely because they catch things you won't. Deferring the evidence to the
diagnosis writeup is too late: by then the alternatives have already been ruled
out, and ruling them out is the part worth challenging.

Read inline instead only when you'll question the same artifact repeatedly (an
ordering you are walking step by step); say which artifact and why.

**Source tracing.** Same dispatch, once the evidence names a concrete symbol /
selector / event / subsystem -- give it that lead, never a topic. Its cap: a
probable call chain (<=8 entries), <=5 files with exact line ranges, one
mechanism summary, <=3 open questions. This is also how you find a POM method,
selector, or command id during the fix; inline `grep`/`cat` sweeps and whole-file
`Read`s are the largest avoidable line item in that phase.

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
   timeline cannot answer. Delegated, its answer costs a few hundred tokens
   rather than the frame's 20k; either way write down what you saw and never
   re-read it.
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

The mined log excerpt is **time-sliced to the failing action's wait** and keeps
all severities inside it, plus a derived "went quiet before the deadline" report
(see `mineLogs` in `lib-failure-window.js`). So it *does* show sequence and
timing within that window, and an `[info]`-level line there is often the decisive
evidence -- read it before escalating.

It is still a bounded sample, and these remain reasons to go to the raw logs
(Level 4):

- **Anything outside the window.** The slice starts ~5s before the failing action
  and ends ~2s after it. A cause that was set in motion during app startup, or in
  a *preceding test* in the same spec file, falls outside it entirely.
- **You need a full channel, in order.** The excerpt round-robins across logs
  under a line/char budget, so per-file coverage is partial. A multi-step sequence
  (activate, create, cancel, reconnect) is easiest to read end-to-end in the file
  itself.
- **The trace had no wall-clock anchor.** Without one, the excerpt falls back to
  the old error-line grep and says so on its first line -- in that case
  `[info]`-level lines and silence really are invisible, and the caveats that
  used to apply always now apply to that run.

## Reading raw logs (Level 4)

The S3 report is the complete source -- it keeps each attempt (attempt 0 = the
failure). Do **not** hand-download a GitHub Actions artifact zip to get app-side
logs: with CI `retries=1`, a flaky test's per-test logs
(`server/.../positron.positron-supervisor/*.log`, kernel logs) are overwritten by
the passing retry in the artifact, so it shows a *clean* run and will mislead you
into thinking the failing logs are gone. `--keep-raw-logs` on the report is the
path to the failing kernel/supervisor logs; never escalate to a ci-arm repro just
to recapture logs the report already has.

Re-run `fetch-pattern-evidence.js` with `--keep-raw-logs`. The logs are extracted
into this triage's own evidence dir and the exact path comes back as `rawLogDir`
in the JSON -- read that path directly.

**Never `find` the OS temp dir for a `logs-*.zip`.** The zip is named
`logs-<shortId>.zip` where `shortId` is the spec-**file** hash, so every test in
a file produces the same filename. A leftover dir from an earlier triage of a
*sibling* test in the same spec is indistinguishable by name and will hand you
the wrong run's logs, with internally consistent timestamps from the wrong day.
If `rawLogDir` is null, the report had no log bundle attached -- say so rather
than reaching into temp.

Run the fetch yourself, then hand the subagent `rawLogDir` and the channel to
read -- a full channel file is the largest artifact on the ladder and the one
whose answer is usually a single ordering.

Each extension's real output channel is its own file under
`server/exthost2/<extension-id>/*.log` (e.g.
`ms-python.python/Python Language Pack.log`), separate from the top-level
`e2e-test-runner.log` the digest draws from. Read the **full channel file**, not
just the excerpt's sample of it -- the multi-step sequence (activate, create,
cancel, reconnect) needed to see what actually happened often runs longer than
the excerpt's per-file budget, and may start before its window opens.

```bash
# RLD is the rawLogDir value from the fetch-pattern-evidence.js JSON.
find "$RLD" -iname '*<extension-id-or-keyword>*'
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
