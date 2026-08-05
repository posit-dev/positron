# Local evidence -- reference

Read this when the triage entered from a **local** failure rather than CI
history. It owns acquisition only: where local artifacts live, which run to
investigate, and what local evidence cannot answer. Everything after the summary
is the same as the CI entry -- the rubric, the escalation ladder, the RED bar --
so nothing about *method* is repeated here.

## What a local run actually leaves behind

Off CI, `playwright.config.ts` sets `reporter = [['list']]`, and drops even the
html reporter when `CLAUDE_CODE` is set. **There is no report.json to read**,
which is why the collector walks the output directories itself instead of reusing
the CI entry's report processor.

| Artifact | Where | Written when |
|---|---|---|
| `_trace.zip` | `test-results/<test-dir>/` | **every** run, pass or fail (`reporting.fixtures.ts` only unlinks passing traces on CI) |
| `error-context.md` | `test-results/<test-dir>/` | failures only -- so it, not the trace, is the failure signal |
| screenshots | `test-results/<test-dir>/` | `takeScreenshot` calls, plus one on failure |
| app / kernel logs | `test-logs/<project>/<spec>/` | every run; **not** under `test-results/` |

Two consequences worth holding onto:

- **A trace is not evidence of failure.** Passing runs keep theirs locally. The
  collector reads `error-context.md` presence instead.
- **`retries: 0` locally**, so there is no failed/passing attempt pair to diff --
  the CI entry's strongest evidence type. What local *does* have is a retained
  trace for a passing run, so a green ordering can be diffed against a red one
  from the same machine. Use `--dir` to collect the passing run second.

## Collect

```bash
node .claude/skills/triage-e2e-test/scripts/collect-local-evidence.js
```

No arguments is the intended call: it picks the best-ranked run (failures first,
then newest) and writes `summary.md` in the same shape the CI entry produces.
`--test '<substring>'` narrows by directory name, `--dir <exact>` pins one,
`--list` shows what's there without collecting.

Act on `verdict`:

| Verdict | Means | Do |
|---|---|---|
| `ok` | one failed run selected | read `summaryFile`, continue to the rubric |
| `no-results` | nothing has run locally | **offer to run it** (below), don't stop |
| `no-failure` | runs exist, none failed | say so; offer a `--repeat-each` run for a flake |
| `ambiguous` | the filter matched several runs | present them and ask; then `--dir` |

**`no-results` is not a dead end.** It is the ordinary state before the first
run, so it must end in an offer, not a report:

```bash
npx playwright test <spec> --project e2e-electron --grep '<test name>'
```

This is the one place the local entry needs a test identity, and only to build
that command -- so run `resolve-test-key.js` *here*, lazily, rather than at
entry. With artifacts already on disk, the results directory names the test and
no resolution is needed at all.

## What local evidence cannot answer

The summary states these rather than leaving them to be assumed:

- **No rate, no environment spread.** One local failure says nothing about
  frequency or whether it is OS/browser-specific. If either matters, hand the
  test to the CI entry -- they compose, and that read is one command.
- **No sibling outcomes.** With no report, the collector can't say which other
  tests in the spec passed. Rerun the whole spec if pollution is the theory.
- **No prior-triage check.** That search matches PR bodies against CI history;
  it is a CI-entry question.

## Checkpointing: only once you escalate

Don't `--init` a checkpoint for a local dig. The phase machine sequences the CI
entry's steps (three of its phases have no local meaning), and the done-gate
exists so a *future* CI triage reads the diagnosis block -- a reader a local
session doesn't have.

Checkpoint at the moment that stops being true: you are about to open a PR or
file an issue, or the engineer wants a `/clear`. Then resolve the key and init
where you actually are:

```bash
node .claude/skills/triage-e2e-test/scripts/checkpoint.js --triage-id <id> \
  --init --test-key '<key>' --phase evidence-gathered
```

From there the close-out is unchanged: declare an `outcome`, record the block
with `record-diagnosis.js`, then `phase=done`.
