# Memory usage monitoring

Design for posit-dev/positron#15001.

Date: 2026-08-06
Status: approved, ready for implementation planning

## Problem

Positron's memory usage has grown over time, and nothing measures it. Changes land
that add hundreds of megabytes to every session, and we find out anecdotally, months
later, usually from someone on an older machine.

The examples in the issue share a shape worth noticing:

| Change | Cost | Where it lives |
| --- | --- | --- |
| Isolated DuckDB worker for CSV/TSV (#13998) | ~100mb per session | its own child process |
| Bundled Quarto language server | ~100mb at startup | its own child process |
| Copilot loaded at startup | ~200mb (tokenizer et al) | inside the extension host |
| Catalog explorer loading the Snowflake SDK | ~10mb at startup | inside the extension host |

Every one is an always-on cost, present when the app sits doing nothing. None of them
requires a feature to be exercised to show up. That is what makes this tractable: we do
not need to drive Positron through every feature. We need to measure a boring, idle app
very consistently, and break the number down far enough to name the culprit.

## Goals

- Surface Positron's total memory footprint and its composition, per run.
- Track both over time so a step change is visible.
- Attribute growth to a specific process, or failing that, to a specific extension.
- Keep the maintenance cost near zero when Positron's process layout changes.

## Non-goals

This design deliberately does not reduce memory usage. It produces the measurements
that make reduction work reviewable.

Also out of scope for the first implementation:

- Threshold alerting and Slack notification (phase 2, see below)
- A CI check that fails a build on regression
- Any scenario other than idle
- Per-extension byte attribution via extension host heap snapshots
- Fixing the `--status` memory bug described under Findings (filed separately as #15382)

## What we measure

### Scenario

One scenario, `idle`. Launch a released Positron build on a fixed workspace with a
fresh user data directory, wait for it to settle, sample.

`interpreters.startupBehavior` is pinned to `manual` (see
`src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts:743`) so
that idle means idle. A runtime starting on its own would add both memory and variance
that belong to a later scenario.

Settling is detected, not slept through: poll the process tree total every second until
it moves less than 1% across three consecutive polls, with a 90 second cap. The time to
settle is recorded as `settle_ms`. It costs nothing extra and is a useful leading
indicator in its own right.

Once settled, take three samples five seconds apart. The per-process figure stored for
that launch is the median of those three, with the min and max kept so within-launch
jitter is visible rather than hidden by the median.

Each run performs **three separate app launches** and stores all three, tagged with
`launch_index`. Launch-to-launch variance dominates sample-to-sample jitter, because a
lazy extension can win or lose an activation race and shift the total. Storing every
launch means phase 2 can choose an alert threshold from measured variance rather than a
guess.

### Metric: PSS, not RSS

Summing per-process RSS across the tree double-counts. Chromium processes share large
mapped regions (the Electron framework, ICU data, fonts), and RSS charges those pages in
full to every process that maps them. The overcount is not a constant offset either: it
grows with the process count, so adding a worker would inflate the reported total by more
than the worker actually costs. Adding a worker is exactly the change we most want to
measure honestly, so this is the one error we cannot live with.

On Linux, `/proc/<pid>/smaps_rollup` reports PSS, which divides each shared page among
its sharers and therefore sums correctly across a tree. We use PSS as the primary figure
and record RSS alongside it for continuity with other tools.

The equivalent measures on other platforms are phys_footprint (macOS) and Private Working
Set (Windows). They are neither free to obtain nor comparable to PSS, which informs the
platform decision below.

### Platform

Phase 1 runs on Ubuntu only: `ubuntu-latest-8x` inside
`ghcr.io/posit-dev/positron-ubuntu24:24.15.0`, the same container as the existing e2e
Ubuntu lane.

Three reasons:

1. Linux is the only platform that hands us an additive memory figure without ceremony.
2. The container image is pinned, so interpreters, system libraries and fonts are
   identical night to night. Low variance is the prerequisite for detecting a 10mb
   regression, and hosted macOS and Windows images are updated underneath us, which would
   land as a phantom step change.
3. Every regression class in the issue is cross-platform. One platform catches them.

Cross-OS numbers were never going to share a chart anyway, since the process models and
the underlying measures differ. Additional platforms are therefore additive work with
independent baselines, and can be added later without reworking anything here.

## How we collect

**Names come from Positron. Numbers come from the OS.** Neither source can do both jobs.

Positron spawns several utility processes whose command lines are byte-identical:

```
6952  --type=utility --utility-sub-type=node.mojom.NodeService ...
6953  --type=utility --utility-sub-type=node.mojom.NodeService ...
8366  --type=utility --utility-sub-type=node.mojom.NodeService ...
8367  --type=utility --utility-sub-type=node.mojom.NodeService ...
8368  --type=utility --utility-sub-type=node.mojom.NodeService ...
```

Command lines do identify some process types perfectly well: `--type=renderer`,
`--type=gpu-process` and `--utility-sub-type=network.mojom.NetworkService` are
unambiguous. The problem is the `NodeService` pile above, where argv distinguishes
nothing. `comm` is worse still: nine processes all report `Positron Helper`.

Only Positron can name those, via
`UtilityProcess.getAll()`
(`src/vs/platform/diagnostics/electron-main/diagnosticsMainService.ts:92`), surfaced
through the `--status` CLI flag, which prints them as `shared-process`, `pty-host`,
`extension-host [1]`, `file-watcher [1]` and `agent-host`, with descendants nested
underneath.

Positron's memory column, however, is unusable (see Findings). So:

1. Walk descendants of the Electron main PID, reading PSS and RSS per PID from
   `smaps_rollup`.
2. Run `--status`, pointed at the instance's user data directory so it reaches the
   running app, and parse the output into `{pid, name, depth}`.
3. Join on PID.

### Labeling and graceful degradation

A joined process gets a `process_role` from a pure name-to-role function. Roles are
fixed and low-cardinality:

```
main, renderer, gpu, network, shared, extension_host, pty_host,
file_watcher, agent_host, kernel_supervisor, kernel, language_server,
extension_child, utility_other, unlabeled
```

Roles come from the Positron name where there is one, falling back to argv for the types
argv identifies reliably. A process that neither source can classify is recorded as
`unlabeled`, with `labeled` false. It is never dropped and never folded into a neighbour.

This is what keeps the maintenance cost down. When
someone adds the next DuckDB worker, it appears in the chart as a 100mb `unlabeled` bar.
The run does not break, nobody had to predict the new process, and the fix is one entry
in the role map.

`process_role` is the grouping key, so it must stay low-cardinality. Display detail goes
in `process_name`: a renderer is role `renderer`, and its window title lives in
`process_name` only. This mirrors the rule already stated in
`test/e2e/utils/metrics/README.md` for `target_description`, which is display-only and
never grouped.

### Extension inventory

Alongside the process tree we record which extensions activated at startup, with their
activation times and events, read from the Running Extensions editor.

This is the companion signal for costs the process tree cannot separate. Copilot and the
Snowflake SDK both live inside `extension_host`, so no amount of process detail will
split them. "Extension host grew 200mb and `github.copilot` now activates at startup" is
an actionable finding without per-extension byte accounting.

The scrape is the most fragile part of the collector. A failure degrades to "no extension
inventory" and still publishes the process tree.

## Schema

Two flat, denormalized datasets, so the dashboard charts them without joins.

`memory_processes`, one row per process per launch:

| Field | Notes |
| --- | --- |
| `run_id`, `timestamp`, `branch`, `commit_sha` | run identity |
| `app_version`, `build_number` | build identity |
| `platform_os`, `platform_version` | |
| `container_image` | pinned image tag, so image bumps explain step changes |
| `scenario` | `idle` |
| `launch_index` | 0, 1, 2 |
| `settle_ms`, `tree_total_pss_bytes` | run-level, denormalized for easy charting |
| `pid`, `ppid`, `depth` | tree structure |
| `process_name` | display only, may be high-cardinality |
| `process_role` | grouping key, fixed vocabulary |
| `labeled` | false means Positron did not name it |
| `cmd_basename` | fallback identification |
| `pss_bytes`, `rss_bytes` | median of the samples in that launch |
| `pss_min`, `pss_max` | |

`memory_extensions`, one row per activated extension per launch:

| Field |
| --- |
| `run_id`, `timestamp`, `branch`, `platform_os`, `launch_index` |
| `extension_id`, `is_builtin`, `activation_time_ms`, `activation_event` |

### Ingestion

A new `POST /memory` endpoint on the e2e-test-insights API, taking one batched payload
per run: run-level fields plus a `processes[]` array and an `extensions[]` array.

Batching matters. The existing `/metrics` endpoint takes one row per request, which for
memory would mean a partially written tree could surface as a fake memory drop. One POST
per run makes each run land atomically.

The existing `/metrics` endpoint is left alone. It requires `duration_ms`, and
`clean_performance_data()` drops rows where `duration_ms <= 0`, so memory data does not
fit it. More importantly memory rows are a different grain, one row per process rather
than one per timed operation, and forcing them into a per-operation table would make them
second-class in every existing chart.

Publishing is gated on branch the same way `test/e2e/utils/metrics/api.ts:85` already
gates PROD against LOCAL, so a dispatched branch run produces a full report but never
contaminates the main baseline.

## Outputs

### Per-run, on the GitHub run

The dashboard answers "is this creeping up over months". It does not answer "what is this
build made of right now", which is a hierarchical table and a poor fit for Shiny. The
manual-dispatch case makes the per-run view necessary: someone who suspects their branch
adds memory wants the tree and the delta on the run page, not a trip to a dashboard that
only ingests nightlies from main.

- **Step summary** (markdown, visible inline with no clicks): totals, top processes by
  PSS, delta against the previous main nightly, and what is new (processes and
  extensions that were not there before).
- **HTML artifact**: the full indented process tree and the complete extension inventory,
  following the pattern in `test/e2e/tests/assistant-eval/_helpers/format-results.ts:159`.

Both are rendered from the same snapshot JSON by one pure function, so the marginal cost
of the second output is small.

The delta requires a GET of the previous main nightly from `/memory`. This is the same
comparison phase 2 alerting will need, so it is built once. A missing baseline degrades to
absolute numbers only.

### Dashboard: Memory sub-tab

Under the existing Perf Metrics tab:

- Total tree PSS over time.
- Stacked area by `process_role` over time, the "what is it made of" view.
- Current versus seven days ago per role, sorted by delta.
- Count of extensions activated at startup over time, with a diff list.

## Workflow

`test-memory-metrics.yml`, modeled on `release-screenshots.yml`, which already
establishes the pattern of a nightly cron plus `workflow_dispatch` running against a
downloaded release build.

- Triggers: nightly cron at 07:00 UTC, chosen to avoid the existing 02:00 and 09:00 UTC
  scheduled workflows so the runner is not shared. Plus `workflow_dispatch` with
  `version` / `build_from_source` inputs for A/B testing a branch.
- Build: reuse `.github/scripts/release-screenshots/download-build.sh`. A released
  artifact, not a source build. Unbundled extensions and sourcemaps would make dev-build
  memory numbers meaningless.
- One spec, `test/e2e/tests/performance/memory-idle.test.ts`, one worker, nothing else on
  the runner.
- Steps: download, launch and snapshot three times, GET baseline, render step summary and
  HTML artifact, POST results.

## Modules and testing

The fragile parts are small, isolated, and testable without launching anything.

| Module | Responsibility | Depends on | Tested by |
| --- | --- | --- | --- |
| `process-tree.ts` | Walk descendants of a PID, read PSS/RSS. No labeling. | procfs | fixtures |
| `positron-status.ts` | Run `--status`, parse to `{pid, name, depth}` | the CLI | captured-output fixtures |
| `label.ts` | Pure `(name, argv) -> process_role` | nothing | vitest |
| `snapshot.ts` | Settle-poll, sample, join, emit snapshot JSON | the three above | the e2e spec |
| `render.ts` | Pure `(snapshot, baseline?) -> {markdown, html}` | nothing | vitest |
| `publish.ts` | Batched POST to `/memory` | the API | the e2e spec |

The two most likely breakages are upstream changing the `--status` text format and a new
unnamed process appearing. Each is confined to one module, and neither can fail a run: an
unparseable line and an unknown name both degrade to `unlabeled`.

Vitest currently includes only `src/vs/**` and `src/*.vitest.{ts,tsx}` (`vitest.config.ts`).
Extending the include glob to cover `test/e2e/**/*.vitest.ts` is a one-line change and is
what makes the labeler and the renderer unit-testable. The low-maintenance claim depends
on it.

## Phase 2

Deferred until a few weeks of nightlies tell us the real run-to-run variance:

- Threshold alerting through `scheduler-slack.Rmd`. The Slack machinery exists
  (`slack_helpers.R`, `slack_alert_helpers.R`) but currently alerts only on run summaries
  and scheduler health, never on metric data, so this would be the first of its kind.
- Additional scenarios: idle plus a Python session, plus R, plus an open notebook.
- Additional platforms, as independent series.
- A CI check that fails past a hard ceiling.

Phase 1 stores raw per-process, per-launch rows with a stable scenario key, so every one
of these is computable from data already collected. None requires re-collection.

## Risks

**Variance may exceed the signal.** Runner noise could swamp a 10mb regression. The
three-launch design measures this honestly rather than assuming it away, and per-process
rows stay sensitive even when the total does not: 10mb is invisible in a 1.5gb total but
obvious in a 40mb process.

**The extension scrape is DOM-dependent** and will break eventually. It degrades to
omitting the inventory rather than failing the run.

**Container drift.** The image is pinned, so a version bump is a deliberate act, but it
will produce a step change. Record the image tag with each run so that step is
explainable rather than mysterious.

**Idle may be too narrow.** It covers every example in the issue, but a regression that
only appears under load will not be caught until phase 2 adds scenarios.

## Findings

Two things surfaced while designing this that are worth acting on separately.

**`--status` reports nonsense memory on macOS and Linux.** The percentage-to-bytes
conversion happens twice: `src/vs/base/node/ps.ts:29` converts `ps -o pmem=` output to
bytes, then `src/vs/platform/diagnostics/node/diagnosticsService.ts:559` multiplies by
total memory and divides by 100 again, as though the value were still a percentage. On a
36GB machine this prints figures like `42749012088` MB. It is also fed by `pmem`, which
has 0.1% granularity, or roughly 36MB steps, which is why several processes report
byte-identical values. Nobody has been able to trust this column. Filed as #15382.

**The `process_role` map is the one thing anyone has to maintain**, and it is a pure
function with a unit test. This is intentional and should stay that way. Any pressure to
add cleverness to labeling should be resisted in favour of adding a row to the map.
