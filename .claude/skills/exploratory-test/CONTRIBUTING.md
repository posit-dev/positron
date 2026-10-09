# Changing exploratory-test

## How it works

A run is a chain of agents. Each one is a fresh session that sees only what it
is handed:

1. **Explorer** (`explorer.md`) drives Positron through drive-positron's
   helpers and writes two files to the run directory: `report.md`, the
   findings, and `ledger.md`, what it ran, the files a repro needs, its logs
   and screenshots.
2. **Verifier** (`verifier.md`) never touches the app. It reads the report,
   the ledger and the diff, and gives each finding a verdict: CONFIRMED, FALSE
   POSITIVE or UNRESOLVED. It also flags a finding that matches a known issue
   (`KNOWN:`) or one closed as not planned (`INTENDED:`).
3. **Isolator** (`isolator.md`) runs only when a finding is UNRESOLVED. It
   launches its own instance, runs a few controls in 12 minutes, and writes
   `isolation.md`. The verifier is then sent that file and revises.
4. **Editor** (`editor.md`) rewrites each finding's title and opening for a
   reader who wasn't there. It never touches the repro steps, and a rewrite
   that fails `reviewEdits` is dropped in favor of the original.

`renderer/render.mjs` then turns `report.md` into `index.html`.

Local and CI runs share every step after the explorer: `finishRun` in
`renderer/pipeline.mjs` runs them in order and is given only a way to run an
agent. Locally that is `claude -p` (`renderer/claude-cli.mjs`), which uses the
person's own login; in CI it is an Agent SDK session (`run.mjs`). So a change
to the order, a retry or a fallback goes in `pipeline.mjs`, and both get it.

No step after the explorer can fail the run. A crashed or empty reply leaves
the report as the explorer wrote it, with the findings marked unreviewed.

## Where things live

| To change | Edit |
|---|---|
| What an agent is told | `explorer.md`, `verifier.md`, `isolator.md`, `editor.md` |
| Step order, retries, fallbacks, the isolator's brief | `renderer/pipeline.mjs` |
| How a local run starts an agent | `renderer/claude-cli.mjs` |
| The verifier's prompt and how verdicts are applied | `renderer/finish.mjs` |
| The editor's prompt and how rewrites are checked | `renderer/edit.mjs` |
| The report format | `explorer.md` (the spec), `renderer/report-parse.mjs` (the parser), `renderer/lint.mjs` (the checks) |
| The page | `renderer/html.mjs` (template), `renderer/report-css.mjs` (tokens) |
| Linked issues the agents see | `renderer/known-issues.mjs` |
| Secrets | `renderer/redact.sh` (text), `renderer/scan-shots.mjs` (screenshots) |
| Publishing a local run | `renderer/publish.sh` |
| Run stats, usage counts | `renderer/stats.mjs`, `renderer/usage.mjs` |
| CI's prompt and agent sessions | `.github/actions/pr-exploratory-test/run.mjs`, `lib.mjs`, `session.mjs` |
| Whether a PR gets a run | `gate.mjs` (declines `/explore`), `suggest.ts` (suggests it) |
| The PR comment | `renderPrComment` in `lib.mjs`, posted by `comment.mjs` |
| The workflows | `test-exploratory.yml` (`/explore` and manual runs), `test-exploratory-suggest.yml`, `exploratory-test-checks.yml` |

Launching and driving the app belongs to drive-positron. See its
[CONTRIBUTING.md](../drive-positron/CONTRIBUTING.md).

## Rules

- **Bump the version when an agent is told something new.** That is
  `metadata.version` in SKILL.md; the comment above it lists the files that
  count. Stats and feedback are grouped by version, so a prompt change under
  an old number muddies both. One bump per PR is enough. A renderer-only
  change needs none.
- **Verdicts annotate, they never delete.** A wrong FALSE POSITIVE that
  removed a real finding would be invisible to everyone.
- **Order lives in `pipeline.mjs`.** Don't add a step to SKILL.md or to
  `run.mjs`. They only say how to run an agent.
- **CI-only facts stay in `run.mjs`.** The pre-attached session and the
  skipped prelaunch go in its prompt tails, not in the agent files, which
  local runs read too.
- **A format change lands in three places at once:** `explorer.md`,
  `report-parse.mjs` and `lint.mjs`, with a test. The parser is lenient on
  purpose, so a mismatch renders wrong without saying so.
- **Decide what publishing does with a new run-directory file.**
  `publish.sh` strips working files and redacts the rest. A file it doesn't
  know about gets uploaded.
- **New `.mjs` files go on `.eslint-allowed-javascript-files`**, beside the
  others. ASCII only, tabs for indentation.

## Test it

```bash
(cd .claude/skills/exploratory-test/renderer && npm ci && node --test)   # ~10 s
(cd .github/actions/pr-exploratory-test && npm ci && node --test)        # ~1 s
```

`exploratory-test-checks.yml` runs both, plus the version check, on any PR
that touches these folders.

No test runs a real agent. For a change to a prompt or to the pipeline,
replay a saved run: copy a run directory whose `report.md` is as the explorer
left it, and run `node renderer/pipeline.mjs run <copy> --repo <checkout>
--base <sha> --head <sha>` on it. A replay sends no usage row: a CI run has
`cost.json`, and a local one keeps the `usage-reported` marker from its first
render. That covers everything after the explorer,
the isolator included when a finding comes back UNRESOLVED. For the explorer,
run the skill locally on a small branch, or start `test-exploratory.yml` with
workflow_dispatch on your branch. A `/explore` comment always runs main's copy
of the harness, so it won't test your change.

To see a template change on a past run, re-render it:
`node renderer/render.mjs <run dir>/report.md`.
