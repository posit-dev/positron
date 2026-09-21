# PR-triggered exploratory testing (`/test`)

Status: design, not yet implemented
Date: 2026-09-21

## Problem

Exploratory testing of a change happens only when someone remembers to do it on
their own machine, with their own skill setup. The `exploratory-testing` skill
(v1) already produces good reports, but it is invoked by hand, its output lives
in one person's home directory, and nothing about it is visible on the PR.

## Goal

A `positron-dev` team member comments `/test` on a PR. CI builds that PR's code,
launches Positron, drives it as a user, and posts a short triage table back to
the PR with the full report and screenshots one click away.

## Non-goals

- Replacing e2e tests. This is discovery testing; regressions it finds should
  get e2e coverage separately.
- Running automatically on every PR. `/test` is on-demand only, for the same
  reason PETE is (see #14494): the cost is real and the author already has the
  skill locally.
- Filing issues or making a merge call. v1 is explicit that the person decides
  what is real, and that stays true here.
- Fork PRs from outside the team. Blocked by the membership gate, by design.

## User flow

1. Member comments `/test` on a PR.
2. Within seconds, an `eyes` reaction appears on their comment.
3. A comment is posted: "Exploratory test running", with a link to the run.
4. About 25 to 40 minutes later that same comment is edited in place to hold the
   triage table, with the full report in a collapsed block.
5. The reaction flips to `rocket` or `confused`.

## Architecture

Three jobs in `.github/workflows/pr-exploratory-test.yml`, triggered by
`issue_comment: [created]`.

```
gate  ->  explore  ->  (comment upsert happens inside explore)
```

### Job 1: `gate`

Copied from `pr-test-checker.yml`'s gate job, unchanged in substance.

- Cheap event-shape prefilter in `if:`: `github.event.issue.pull_request != null`
  and the comment body starts with `/test`.
- Mints a short-lived token from the "Positron Projects" GitHub App
  (`POSITRON_PROJECTS_CLIENT_ID` + `POSITRON_PROJECTS_PEM`) scoped to `posit-dev`,
  which carries `Members: read`.
- Requires `orgs/posit-dev/teams/positron-dev/memberships/<user>` to report
  `state == "active"` for BOTH the commenter and the PR author.
- Fails closed: any token or API error yields `ok=false` and nothing runs.
- `permissions: {}`. Checks out no code.

A blocked caller currently gets silence: the `eyes` reaction lives in `explore`,
which never starts. PETE behaves the same way. Accept it for v1 rather than
granting the gate job write access purely to post a rejection, which would
hand comment-write permission to the one job that runs for every PR comment on
the repo.

Use `startsWith` on the trimmed comment body, not `contains`. `pr-build-dmg.yml`
uses `contains(body, '/dmg')`, which fires on any comment that merely mentions
the command. This is the same over-matching class as `pr-tags-parse.sh` picking
up `@:tag` inside backticked prose.

### Job 2: `explore`

`runs-on: ubuntu-latest-8x`, container `ghcr.io/posit-dev/positron-ubuntu24:24.18.0`,
`options: --user 0:0 --init`, GHCR credentials from `POSITRON_GITHUB_RO_USER` /
`POSITRON_GITHUB_RO_PAT`. Needs `needs: gate` and `needs.gate.outputs.ok == 'true'`.

Permissions must be declared explicitly. The job writes reactions and comments,
and an `issue_comment` workflow does not get those by default:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

This mirrors PETE's `run` job.

`concurrency: pr-exploratory-${{ github.event.issue.number }}`, `cancel-in-progress: true`.

`timeout-minutes: 90`. Budget is roughly 16 min of build worst-case plus up to
about 60 min of driving, with headroom. This is the real cost backstop; the turn
cap is a secondary guard.

Steps, in order:

1. `eyes` reaction on the triggering comment (first, so it lands before the slow
   steps). Capture the reaction id for the finalize step.
2. Resolve both SHAs from one `gh api repos/.../pulls/<n>` call: `.head.sha`
   and `.base.sha`. Use `.base.sha`, not current `main`, as the diff base, or the
   diff picks up everything merged since the PR was opened.
3. Post the initial "running" comment with the marker `<!-- exploratory-test -->`.
4. Checkout PR head, `fetch-depth: 0`, `submodules: recursive`,
   `persist-credentials: false`.
5. Load secrets from 1Password: `ANTHROPIC_KEY` at `op://Positron/Anthropic/credential`.
6. The build steps lifted from `test-e2e-ubuntu.yml`, in its order:
   `restore-build-caches`, `install-npm-parallel.sh` (gated on cache miss),
   `download-binaries`, e2e deps, `npm exec -- npm-run-all -p compile "electron x64"`,
   `npm run prelaunch`, SUID `chrome-sandbox`, `setup-test-env`.
7. `.github/actions/setup-xvfb` for `DISPLAY=:10` and a shared dbus session bus.
   `test-e2e-ubuntu.yml` does not use this action, because Playwright manages the
   display for it. We launch outside Playwright, so we need it.
8. `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
9. Write the minimal seed profile (see "Seeding the profile").
10. `gen-report-dir` to allocate `REPORT_DIR` and `REPORT_URL`.
11. Run the agent (`run.mjs`).
12. Upload the run directory to S3, upload it as an artifact, and upsert the
    result comment. All `if: always()`. If the S3 upload fails, set a flag and
    have the comment step omit the image links and the Report link rather than
    emit CDN URLs that 404. The artifact link still carries the shots.
13. Finalize reaction: `rocket` only when the agent finished on its own. A
    partial run (turn cap or timeout) and a hard failure both get `confused`.

## Build, not artifact reuse

Measured on a recent `test-merge.yml` run (35462601246) and a recent
`test-e2e-ubuntu.yml` run (30109297458):

| Path | Time to a launchable app |
|---|---|
| `test-e2e-ubuntu.yml`, warm npm cache | ~11.5 min |
| `test-e2e-ubuntu.yml`, cold npm cache | ~16 min |
| Download + extract `positron-build` artifact | ~7 min |
| Producing `positron-build` (`setup / build-ubuntu`) | ~14 min |

Reusing a prebuilt artifact would save about 4.5 minutes, but it is not
available on the trigger we care about: `test-pull-request.yml` calls the
all-in-one `test-e2e-ubuntu.yml`, which never uploads `positron-build`. Only
`test-merge.yml`, `test-full-suite.yml`, and `test-cross-browser.yml` use the
build/run split, with 1-day retention.

Producing the artifact ourselves is worse, not better: 14 min to build plus 7 min
to consume is ~21 min against ~11.5 min for the all-in-one. The split pays only
when one build amortizes across many shards, which a single `/test` job does not.

Downloading main's artifact instead is the one option that must be rejected
outright. v1's SKILL.md warns that a run against main "yields a clean report
indistinguishable from a real one, so nobody catches it."

Decision: build every time, riding the cache the PR e2e lane already keeps warm.
Accept the ~7 min penalty on a cache miss.

## Driving the app

Use `.claude/skills/drive-positron` (CDP attach plus `npx @playwright/cli`), which
is what v1's SKILL.md already directs the tester to use. Do not use
`test/e2e/infra`. The two are unrelated code paths, and `drive-positron`'s
one-bash-call-per-action interface is the one an agent in a harness wants.

`drive-positron` is a live local skill, not a frozen copy. If its CLI surface
changes, the CI tail that teaches the agent how to invoke it has to change with
it. Treat an interface change there as a change to this workflow.

### `launch.sh` is not forked

`.claude/skills/drive-positron/scripts/launch.sh` is already a hand-maintained
fork of `.agents/skills/launch/scripts/launch.sh` that does not inherit upstream
fixes. A second fork for CI would be the wrong direction. Two gaps, both closed
without touching the file. Line numbers below refer to
`.claude/skills/drive-positron/scripts/launch.sh`.

**No source profile.** Line 122 seeds from `$POSITRON_DEV_USER_DATA_DIR`
or `~/.positron-dev` and exits if neither exists. CI has neither. Pass
`--source-user-data-dir /tmp/positron-seed` (a launcher argument, so before the
`--`) after writing a minimal seed, exactly as SKILL.md documents.

**No container handling.** The script contains no `--no-sandbox`, no
`--disable-dev-shm-usage`, no swiftshader flags, and never sets `DISPLAY`. By
contrast `test/e2e/infra/playwrightElectron.ts:33-47` adds all of these when it
detects Docker. Since everything after the `--` is passed to the app, CI supplies
them there:

```
--no-sandbox --disable-dev-shm-usage --use-gl=swiftshader \
--enable-unsafe-swiftshader --disable-gpu-compositing --password-store=basic
```

`--password-store=basic` is not optional. The CI image has no OS keyring
backend, and without it Electron pops an "An OS keyring couldn't be identified"
modal that intercepts all input. See the comment at
`test/e2e/infra/playwrightElectron.ts:40-47`. Omitting it produces a hang that
looks exactly like a product bug.

`DISPLAY` comes from `setup-xvfb` via the job environment, which `launch.sh`
inherits.

This section is reasoned from `playwrightElectron.ts` and is UNPROVEN. Nobody has
run the script inside a root container. Validating it is the first implementation
task, ahead of any agent work.

### Seeding the profile

```bash
mkdir -p /tmp/positron-seed/User
echo '{}' > /tmp/positron-seed/User/settings.json
```

Interpreter environment variables follow `test-e2e-ubuntu.yml`:
`POSITRON_PY_VER_SEL`, `POSITRON_R_VER_SEL`, `POSITRON_HIDDEN_PY`,
`POSITRON_HIDDEN_R`, `RETICULATE_PYTHON`, `R_LIBS_SITE`, `R_LIBS_USER`.

Note that `/root/.venv` exists in this container and wins interpreter selection.
Any scenario that depends on which interpreter is picked must account for it.

## The agent harness (`run.mjs`)

A composite action at `.github/actions/pr-exploratory-test/`, modeled directly on
`.github/actions/e2e-failure-analyzer/`. Copy its skeleton:

- Node 20, `npm ci` in the action directory.
- Global install of `@anthropic-ai/claude-code` plus `pathToClaudeCodeExecutable`,
  the documented workaround for the Agent SDK resolving the musl binary before
  the glibc one on Linux (claude-agent-sdk-typescript#296).
- `query()` from `@anthropic-ai/claude-agent-sdk` with `permissionMode: 'bypassPermissions'`.
- Final message rendered to `$GITHUB_STEP_SUMMARY` and written to disk.

Two deliberate divergences from the analyzer:

| | analyzer | this |
|---|---|---|
| `allowedTools` | `Read`, `Glob`, `Grep` | `Bash`, `Read`, `Glob`, `Grep` |
| `maxTurns` | 40 | 200 (see "Turn budget") |

`bypassPermissions` is safe in the analyzer because its toolset is read-only.
Here it is not a safety property, it is a convenience one. The safety property is
the membership gate plus the disposable container.

### Prompt construction

`systemPrompt` is v1's `SKILL.md` inlined whole, plus a short CI tail.

Do NOT split the skill into a shared `rubric.md` the way the analyzer does. The
analyzer needs that split because its SKILL.md is mostly local-only procedure;
v1's is not, and keeping one file is the point of choosing v1 over v2. The tail
overrides exactly three things:

1. You are the tester. Ignore "Run it in a subagent"; do not delegate.
2. Write the run directory to `$WORK_DIR`, not
   `~/.claude/skills/exploratory-testing/output/<timestamp>/`.
3. Do NOT clean up. See "Cleanup is inverted in CI".

`drive-positron`'s SKILL.md is NOT inlined. It is on disk in the checkout and v1
already tells the tester to read it there. Inlining a file that large into every
request would be paid on every turn.

`userPrompt` is the self-contained brief v1 asks for: the checkout path, PR
number, head SHA, base SHA, `git diff <base>...<head> --stat`, the PR title and
body as a statement of intent, and the run directory path. Per v1, state intent
and risk; do not state what is expected to work.

### Proving the build is the branch

v1 requires this and it matters more in CI, not less. Before exploring, grep the
compiled output under `out/` for a string the diff introduces, and record the
check in the report's "Run setup" section. A run against the wrong code produces
a clean report that looks exactly like a real one.

## Turn budget

Local `actions.log` files from four real v1 runs recorded 19, 25, 43, and 48
logged actions across 11 to 20 minutes of driving. True turn counts run higher,
since snapshots, greps, and screenshots are not all logged.

Start at `maxTurns: 200` and calibrate over the first several runs. The real
backstop is the job's `timeout-minutes`, not the turn cap.

### Failure mode: cap reached before the report is written

If the agent exhausts its turns it never writes `report.md`, and the deliverable
is lost. Two mitigations, both required:

- v1 already instructs the tester to append to `actions.log` as it goes and to
  copy evidence into `shots/` at capture time, so a truncated run still leaves
  artifacts.
- `run.mjs` must detect a max-turns termination and post a "partial run" comment
  pointing at `actions.log` and the uploaded shots, rather than reporting success.

## Cost accounting

The SDK's `result` message already carries everything needed: `total_cost_usd`,
`usage.input_tokens`, `usage.output_tokens`, `num_turns`, and `duration_ms`.
`run.mjs` handles that message anyway to collect the final report, so recording
this costs no extra call and no instrumentation.

`analyze.mjs:527` logs the same fields today but only to the console, where they
are buried in job logs and cannot be compared across runs. Do better here:

1. Write `cost.json` into the run directory, so it ships with both the S3 upload
   and the artifact and stays retrievable after the job logs age out.
2. Append a footer line to the PR comment: cost, turns used against the cap, and
   wall clock.
3. Append the same line to the step summary.

`num_turns` is the calibration input for `maxTurns`. Recording it per run is what
turns the 200 estimate into a measurement, and it is the mechanism implementation
step 6 depends on.

## Cleanup is inverted in CI

v1 and `drive-positron` both state that cleanup is not optional. In CI it is not
merely optional, it is harmful, and the CI tail must say so explicitly.

Two reasons:

- v1 itself warns that "drive-positron's cleanup deletes the run directory your
  screenshots were written to, and a report linking deleted files is not
  verifiable." In CI we need that directory to survive long enough to upload it.
- The resource argument for cleanup does not apply. The container is destroyed
  when the job ends.

So: do not call `stop.sh`, do not remove the run directory, do not remove
scaffolding workspaces.

## Output

### The comment

One comment, upserted in place via the marker `<!-- exploratory-test -->`, using
the mechanic in `scripts/pr-e2e-comment.sh` (which uses `<!-- PR Tags -->`).
Deliberately unlike `pr-build-dmg.yml`, which posts a second comment rather than
editing the first.

Body:

```
<!-- exploratory-test -->
### Exploratory test: <N> findings

| # | Finding | Type | Impact | Caused by change |
|---|---------|------|--------|------------------|
| 1 | <short claim> | regression | 1 in 3 accepts silently do nothing | yes |

<details><summary>Full report</summary>

... full report body, images embedded from the CDN ...

</details>

[Run](<run url>) | [Report](<cdn url>)
```

### The `Type` column is new

v1's table is `| # | Finding | Impact | Caused by change |`. Add `Type` with
values `regression`, `bug`, or `papercut`. It is a different axis from
`Caused by change`: a bug the change caused is not necessarily a regression of
previously working behavior. Add the column to v1's SKILL.md so local and CI
reports stay identical, with this decision rule so runs classify consistently:

- `regression` -- behavior that used to work is now broken.
- `bug` -- new or changed behavior that never worked correctly.
- `papercut` -- a pre-existing rough edge the change neither introduced nor
  worsened.

### Screenshots

Upload the run directory to the `positron-test-reports` S3 bucket using
`AWS_TEST_REPORTS_ROLE`, the same role `upload-report-to-s3` uses. That action
hardcodes `aws s3 cp playwright-report/.`. Generalize it: add an optional
`source-dir` input defaulting to `playwright-report`, so every existing caller
keeps its current behavior unchanged and this workflow passes the run directory.
A second copy of the same upload logic is the worse option.

Once on S3 the shots are served publicly from
`https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/`, and GitHub renders them
inline in the PR comment. This requires the report step to emit CDN URLs instead
of relative `shots/<file>` links. v1 is emphatic that shots must be real links
rather than backticked paths; the CDN form satisfies that and additionally
renders.

Step summaries cannot render images at all (the analyzer's prompt says so
outright), so the step summary keeps the text report only. The artifact upload
stays as a backup.

## Security model

`issue_comment` runs in base-repo context with full secrets even for fork PRs.
This job compiles and executes PR head code with `OP_SERVICE_ACCOUNT_TOKEN`, the
Anthropic key, and the GHCR PAT in scope.

PETE defends this two ways: the membership gate, and a two-tree checkout where
the base branch runs the action and the PR head is mounted as read-only data.
**The second layer is unavailable to us.** We must build and run the PR's code;
that is the entire point. So the membership gate is the whole defense.

It is a strong one. Requiring the PR author, not just the commenter, to be an
active `positron-dev` member means an outside contributor cannot get their code
executed by baiting a member into commenting `/test`. This is an accepted,
documented tradeoff rather than an oversight, and it is the reason the command is
team-only rather than collaborator-level.

## Files

| Path | Status |
|---|---|
| `.github/workflows/pr-exploratory-test.yml` | new |
| `.github/actions/pr-exploratory-test/action.yml` | new |
| `.github/actions/pr-exploratory-test/run.mjs` | new |
| `.github/actions/pr-exploratory-test/package.json` | new |
| `.claude/skills/exploratory-testing/SKILL.md` | new (v1, checked in; `Type` column added) |
| `.github/actions/upload-report-to-s3/action.yml` | modified (optional `source-dir` input) |

## Implementation order

1. Prove `launch.sh` starts Positron in the `positron-ubuntu24` container as root
   under Xvfb, driven by `npx @playwright/cli`. Everything else depends on this
   and none of it is proven. Do this as a `workflow_dispatch` scratch workflow
   before writing any of the rest. Done means all three: CDP attach succeeds, at
   least one driven action lands (open a file, type in the console), and a
   screenshot taken through `drive-positron` is visible in the workflow
   artifacts. A process that merely starts is not done.
2. Check v1's SKILL.md into `.claude/skills/exploratory-testing/`, with the `Type`
   column added.
3. Build the action and `run.mjs` against a fixed PR number, still on
   `workflow_dispatch`.
4. Add the `gate` job and the `issue_comment` trigger. Delete the scratch
   workflow in the same change, so no stale `workflow_dispatch` entry is left in
   the Actions UI. Steps 1 through 3 stay on `workflow_dispatch`; step 4 is the
   single cutover.
5. Add S3 upload and the CDN-linked comment.
6. Calibrate `maxTurns` over several real runs.

## Open questions

- What is the real turn cost of a CI run? 200 is an estimate from local action
  counts, not a measurement. The `num_turns` field recorded per "Cost accounting"
  answers this after a handful of runs.
- Should per-run cost be aggregated anywhere beyond the PR comment and the
  artifact? The e2e-test-insights webhook the analyzer posts to is the obvious
  candidate, but that is a separate integration and is out of scope for v1.
- Does the agent need a scaffolded workspace, and if so what is in it? v1 says the
  representative case is a populated workspace with warm state, not a fresh
  profile, but a CI run always starts cold. A second launch via `reseed.sh` would
  cover the warm path at roughly double the time; deferred out of v1.
- Should `/test` accept an argument to focus the run (`/test notebooks`)? Not in
  v1.
