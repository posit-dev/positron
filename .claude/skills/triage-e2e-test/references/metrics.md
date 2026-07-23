# Cost metrics -- reference

Every helper appends one JSON line to
`.claude/work/triage-e2e-test/metrics.jsonl` (gitignored) as it finishes. This
is passive: the model doesn't read or write it during a triage. It exists so the
refactor's savings can be *measured* -- median stdout bytes into context, raw
bytes kept on disk instead, resume vs fresh, duration -- rather than assumed.

## Line schema

Every line carries the process-tracked fields, plus phase-specific counts:

| Field | Meaning |
|---|---|
| `ts` | ISO timestamp when the helper finished |
| `script` | `triage-history` / `find-prior-triage` / `fetch-pattern-evidence` / `checkpoint` / `record-diagnosis` |
| `durationMs` | wall time of the helper process |
| `stdoutBytes` | bytes the helper printed to stdout (what lands in model context) |
| `rawBytesWritten` | bytes written to disk (kept out of context) |
| `phase` | `history` / `prior-triage` / `evidence` / `init` / `resume` / `record-diagnosis` |
| `failed` | present (`true`) only when the helper exited via an error |

Phase-specific fields include `patternsFound`, `queriedCurrent`, `branchesQueried`
(history); `prsSearched`, `prsMatched`, `occurrenceShasChecked` (prior-triage);
`rawLogsRetained`, `screenshots`, `pattern` (evidence); `resumed`,
`resumedAtPhase` (checkpoint); `outcome` (record-diagnosis).

## The signal to watch

The core value-prop check is `stdoutBytes` vs `rawBytesWritten`: evidence and
history should show large `rawBytesWritten` (payloads on disk) with small
`stdoutBytes` (compact summaries into context). A run where `stdoutBytes` grows
toward `rawBytesWritten` means a raw payload is leaking into context -- the
regression the boundary is meant to prevent.

## Aggregate

```bash
# Median stdout bytes per phase across all recorded runs.
node -e '
const fs = require("fs");
const path = ".claude/work/triage-e2e-test/metrics.jsonl";
const rows = fs.readFileSync(path, "utf8").trim().split("\n").map(l => JSON.parse(l));
const by = {};
for (const r of rows) { (by[r.phase] ??= []).push(r.stdoutBytes); }
const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
for (const [phase, xs] of Object.entries(by)) { console.log(phase, "n=" + xs.length, "medianStdoutBytes=" + median(xs)); }
'
```

The file is append-only and never rotated automatically; delete it to reset a
measurement window (a `--clean` helper may manage this later).
