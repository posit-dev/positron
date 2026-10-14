# Changing exploratory-test

## How it works

A run is a chain of agents. Each one is a fresh session that sees only what it
is handed:

1. **Explorer** (`explorer.md`) drives Positron through drive-positron's
   helpers and writes two files to the run directory: `report.json`, the
   findings in the shape `renderer/report.schema.json` gives, and `ledger.md`,
   what it ran, the files a repro needs, its logs and screenshots. It checks
   the report with `renderer/lint-json.mjs` until it passes; the pipeline
   runs the same check once it is done and logs what is left.
2. **Verifier** (`verifier.md`) never touches the app. It reads the report,
   the ledger and the diff, and gives each finding a verdict: CONFIRMED, FALSE
   POSITIVE or UNRESOLVED. It also flags a finding that matches a known issue
   or one closed as not planned. It replies with a `json` block, which
   `parseVerifyReply` in `finish.mjs` reads, then its notes.
3. **Isolator** (`isolator.md`) runs only when a finding is UNRESOLVED. It
   launches its own instance, runs a few controls in 12 minutes, and writes
   `isolation.md`. The verifier is then sent that file and revises.

Each of them writes what it decided into `report.json`: verdicts, known
issues, and what each pass cost. `renderer/render.mjs` (or `run.mjs` in CI,
through the same `writeRunPage`) then turns `report.json` into `index.html`.

Local and CI runs share every step after the explorer: `completeRun` in
`renderer/pipeline.mjs` checks the report, runs the later passes in order and
writes what each cost, and is given only a way to run an agent. Locally that is `claude -p` (`renderer/agents/claude-cli.mjs`), which uses the
person's own login; in CI it is an Agent SDK session (`run.mjs`). So a change
to the order, a retry or a fallback goes in `pipeline.mjs`, and both get it.
A local run's explorer is a `claude -p` session too, started by `pipeline.mjs
run --brief`; CI starts its own. Either way a time limit is a hook that tells
the agent once it is up (`renderer/time-up-hook.mjs` locally), and the agent
is stopped only if it is still going ten minutes later.

No step after the explorer can fail the run. A crashed or empty reply leaves
the report as the explorer wrote it, with the findings marked unreviewed.

## Where things live

The top of `renderer/` holds only what gets run: the pipeline, `render.mjs`,
lint, publishing and the scripts the explorer calls, each with its test. What
they use is in four folders: `page/` builds the report page, `lint/` holds the
write-up rules, `agents/` starts agents and reads their replies, and `shared/`
holds the text helpers and the ledger parser.

| To change | Edit |
|---|---|
| What an agent is told | `explorer.md`, `verifier.md`, `isolator.md` |
| Why each agent's rules exist, and what checks them | `RULES.md` |
| Step order, retries, fallbacks, the isolator's brief | `renderer/pipeline.mjs` |
| How a local run starts an agent, and its time limit | `renderer/agents/claude-cli.mjs`, `renderer/time-up-hook.mjs` |
| The verifier's prompt and how verdicts are applied | `renderer/agents/finish.mjs` |
| The report format | `explorer.md` (what to write), `renderer/report.schema.json` (the shape), `renderer/lint-json.mjs` (runs every check on report.json: against the ledger, and the write-up rules), `renderer/lint/lint-wording.mjs` and `renderer/lint/lint-ledger.mjs` (the write-up rules), `renderer/lint/lint-rules.mjs` (each rule's ID and severity), `renderer/page/report-json.mjs` (what the page reads) |
| Reading the ledger | `renderer/shared/ledger.mjs` |
| The page | `renderer/page/html.mjs` (template), `renderer/page/report-css.mjs` (tokens), `renderer/page/page-scripts.mjs` (its scripts), `renderer/page/page-common.mjs` (icons and shared helpers), `renderer/shared/text.mjs` (markdown to safe HTML) |
| A finding card's agent prompt, GitHub issue and feedback links | `renderer/page/card-actions.mjs` |
| Linked issues the agents see | `renderer/known-issues.mjs` |
| Secrets | `renderer/redact.sh` (text), `renderer/scan-shots.mjs` (screenshots) |
| Publishing a local run | `renderer/publish.sh` |
| Run stats, usage counts | `renderer/stats.mjs`, `renderer/shared/usage.mjs` |
| CI's prompt and agent sessions | `.github/actions/pr-exploratory-test/run.mjs`, `lib.mjs`, `session.mjs` |
| Whether a PR gets a run | `gate.mjs` (declines `/explore`), `suggest.ts` (suggests it) |
| The PR comment | `renderPrComment` in `lib.mjs`, posted by `comment.mjs` |
| The workflows | `test-exploratory.yml` (`/explore` and manual runs), `test-exploratory-suggest.yml`, `exploratory-test-checks.yml` |

Launching and driving the app belongs to drive-positron. See its
[CONTRIBUTING.md](../drive-positron/CONTRIBUTING.md).

## Rules

- **Bump the version when a run could find or judge findings differently.**
  That is `metadata.version` in SKILL.md; `versioned-files.txt` lists the
  files that count: the prompts, the lint, and the code that sets what agents
  may do and turns their replies into the report. Add a new file of that kind
  to it. Stats and feedback are grouped by version, so
  such a change under an old number muddies both. One bump per PR is enough. A
  change to how the page looks needs none.
- **A rule in `explorer.md` lands with proof it works:** a lint check with a
  test that fails without it, or a comparison of full runs. A lint check gets an ID and a
  severity in `lint-rules.mjs`. Add or update its row in `RULES.md` in the
  same PR, naming the ID, and read that file before cutting one.
- **Verdicts annotate, they never delete.** A wrong FALSE POSITIVE that
  removed a real finding would be invisible to everyone.
- **Order lives in `pipeline.mjs`.** Don't add a step to SKILL.md or to
  `run.mjs`. They only say how to run an agent.
- **CI-only facts stay in `run.mjs`.** The pre-attached session and the
  skipped prelaunch go in its prompt tails, not in the agent files, which
  local runs read too.
- **A format change lands in three places at once:** `explorer.md`,
  `report.schema.json` and `report-json.mjs`, with a test.
  `explorer-format.test.mjs` checks explorer.md's templates against the
  schema, but the schema accepts fields it does not name, so a field the page
  never reads is dropped without a word.
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
replay a saved run: copy a run directory whose `report.json` is as the
explorer left it, and run `node renderer/pipeline.mjs run <copy> --repo <checkout>
--base <sha> --head <sha>` on it. A replay sends no usage row: a CI run has
`cost.json`, and a local one keeps the `usage-reported` marker from its first
render. That covers everything after the explorer,
the isolator included when a finding comes back UNRESOLVED. For the explorer,
run the skill locally on a small branch, or start `test-exploratory.yml` with
workflow_dispatch on your branch. A `/explore` comment always runs main's copy
of the harness, so it won't test your change.

`page/page.test.mjs` pins the whole page, less its stylesheet and scripts,
for two saved runs under `renderer/fixtures/`, and the scenes in `page/report.test.mjs` pin the cases
those runs do not reach, each named for what the page should do in it
(`fixtures/scenes.expected.txt`). Lint's cases are scenes too, in
`lint/lint-ledger.test.mjs` (`fixtures/lint-scenes.expected.txt`). A change
fails them at the first line that moved; when the change is meant, run
`UPDATE_PAGES=1 node --test page/page.test.mjs page/report.test.mjs
lint/lint-ledger.test.mjs` from `renderer/` and review the diff of the saved
output before committing it. A new case gets a scene, not a test of its
markup or message.

To see a template change on a past run, re-render it:
`node renderer/render.mjs <run dir>/report.json`.
