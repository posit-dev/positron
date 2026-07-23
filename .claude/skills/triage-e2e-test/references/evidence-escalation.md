# Evidence escalation -- reference

`fetch-pattern-evidence.js` gives you Level 1-2 for one occurrence: a compact
manifest plus a deterministic `summary.md` (failure, timeline tail, sibling
tests, error-shaped log lines, unresolved questions). **Escalate past the
summary only to answer a concrete question it raised** -- each level costs more
context than the last, so stop as soon as the mechanism is clear.

## The escalation ladder

1. **History summary** (`triage-history.js`) -- identify active patterns. Do not
   fetch reports for unselected patterns.
2. **Compact processed evidence** (`fetch-pattern-evidence.js` -> `summary.md`)
   -- one representative occurrence for the selected pattern. Read the summary
   only.
3. **One specific artifact** -- open the full `timelineFile`, a `screenshot`,
   the `snapshotFile` (error-context page snapshot), or a source file, only when
   Level 2 raises a concrete unresolved question.
4. **Raw logs** -- read only when the issue depends on sequence/ordering,
   missing output, extension-channel behavior, or process termination -- a
   detail absent from processed evidence (see "raw logs" below).
5. **Additional occurrence** -- fetch a second only to validate repeatability,
   test a race hypothesis, investigate same-file adjacency, reconcile
   conflicting evidence, or check whether a previous fix held. Re-run
   `fetch-pattern-evidence.js` with a different occurrence's `report_url`
   (widen `--occurrences-per-pattern 2` on `triage-history.js` first to get a
   second `report_url`).

## Why the summary can't see everything

The mined log excerpt greps for **error-shaped lines only** (`no such file`,
`traceback`, `\w+error:`, `failed to \w+`, etc. -- see `LOG_ERROR_RE` in
`e2e-process-s3.js`). It cannot show sequence or timing: `[info]`-level lines
never match, so a **race** (two things in the wrong order, neither erroring on
its own) is invisible in the digest by construction. Any time the question is
"what happened, in what order" rather than "what error was thrown," go straight
to the raw logs (Level 4).

## Reading raw logs (Level 4)

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

## Retrieval failures

- **403 from the processor** means "this particular upload isn't fetchable"
  (still in flight, or expired), not "no evidence exists." `fetch-pattern-
  evidence.js` surfaces this as an error -- fall through to the next
  occurrence's `report_url` for the same pattern.
- **`report_url: null`** on an occurrence -- state it explicitly (e.g. "3 of 8
  occurrences have no report available") rather than assuming the reports that
  do exist fully cover the pattern.
