# Memory metrics: which scenarios to measure past idle

Date: 2026-08-12
Issue: [#15490](https://github.com/posit-dev/positron/issues/15490)
Epic: [#15001](https://github.com/posit-dev/positron/issues/15001)

## Why this needs deciding

The idle collector landed in [#15430](https://github.com/posit-dev/positron/pull/15430). It pins
`interpreters.startupBehavior` to manual and never starts a kernel, so it only sees what Positron
allocates before anything happens. The question is what to add, and the answer has to be short:
every scenario is another set of cold launches and another series the dashboard and the eventual
threshold have to carry.

## What idle already covers

Last night's run ([31516453001](https://github.com/posit-dev/positron/actions/runs/31516453001))
reported 1928 MB PSS across 21 processes:

| PSS | Process |
| --- | --- |
| 545 MB | renderer |
| 429 MB | extension host |
| 170 MB | main |
| 155 MB | `electron-nodejs (index.js)`, not attributed to an extension |
| 129 MB | shared process |
| 87 MB | GPU |
| 80 MB | agent host |
| 62 MB | Quarto LSP |
| 61 MB | ruff |
| 30 MB | JSON language server |
| 22 MB | network service |
| 9 / 7 / 6 MB | pet, air, kcserver |

Compare that against the culprits in the 2026-07-30 "Why Positron is a memory hog" talk, which
named eagerly started child servers (duckdb worker 86 MB, Quarto 101 MB, pet 9 MB, air 3 MB) and
eagerly loaded extension code (roughly 120 MB of AI and Quarto in every workspace). Idle already
sees Quarto, ruff, air, pet, and the agent host. Most of the talk is covered.

Three things it cannot see:

- **Kernels.** kcserver is running but empty. Ark and ipykernel never start, and the talk was
  explicit that their memory sits on top of the 500 MB gap, not inside it.
- **The duckdb worker.** It spawns when a CSV is opened, so the single biggest named culprit,
  the one from [#13998](https://github.com/posit-dev/positron/pull/13998) that prompted the epic,
  is invisible in every run we have.
- **Anything a notebook or a plot allocates.** No process for either exists at idle.

## Runtime is not the constraint

The ticket assumes each scenario costs a meaningful slice of the nightly job. It does not. That run
finished in 8.5 minutes against a 45 minute budget, and the three idle launches were 41 seconds
each, 2 minutes total. The other 6.5 minutes is container pull, dependency install, and build
download, all of which a second scenario reuses for free.

So the scarce resource is signal quality, not minutes. A scenario that cannot assert the state it
claims to measure will sometimes snapshot a half-loaded app, and that noise lands in the variance
figure that [#15496](https://github.com/posit-dev/positron/issues/15496) has to set a threshold on.

## Selection rule

A scenario earns a place if it makes memory visible that idle structurally cannot see, and if that
memory has already regressed us or plausibly will.

## The list

| Scenario | Baseline | What it makes visible | Issue |
| --- | --- | --- | --- |
| `idle` | absolute | shipped | [#15430](https://github.com/posit-dev/positron/pull/15430) |
| `session-python` | idle | ipykernel, a loaded kcserver, and the session side of positron-python | [#15491](https://github.com/posit-dev/positron/issues/15491) |
| `session-r` | idle | Ark, a loaded kcserver, and the session side of positron-r | [#15491](https://github.com/posit-dev/positron/issues/15491) |
| `data-explorer` (CSV opened, no session) | idle | the duckdb worker, roughly 86 MB, the regression that prompted the epic | [#15492](https://github.com/posit-dev/positron/issues/15492) |
| `notebook` (one cell run) | `session-python` | the Positron notebook renderer and webview path | [#15492](https://github.com/posit-dev/positron/issues/15492) |
| `plots` (one plot rendered) | `session-python` | the plots service and webview or plot caching | [#15492](https://github.com/posit-dev/positron/issues/15492) |
| `assistant` | idle | gated on a probe, see below | [#15492](https://github.com/posit-dev/positron/issues/15492) |

Notebook and plots are the speculative two. Nothing has regressed in either, but no other scenario
touches those code paths, and both are cheap enough that waiting for a regression to justify them
is a worse trade than measuring them now. The notebook and plot scenarios run against a Python
session.

### Python and R get separate scenarios

The kernels themselves are distinguishable either way, since the snapshot keeps a row per process
and Ark and ipykernel can be told apart by command name. What a combined scenario loses is
attribution of the shared processes. `label.ts` maps both `ipykernel_launcher` and `ark` to one
`kernel` role, so the per-role rollup #15495 charts would sum them, and more to the point both
positron-r and positron-python load their session code into the same extension host heap. That
heap is 429 MB at idle and is where the talk's second culprit lives, so an ext host jump in a
combined run cannot be pinned on either language. Split, and each language's ext host delta over
idle is its own number, which is a coarse version of what #15494 eventually does properly.

Most people also run one language, not both, so a combined figure describes nobody's real session.
The split costs three extra launches, which under the job matrix below is a parallel job and does
not move wall clock.

There is deliberately no third scenario with both languages running at once. It would catch
interaction effects such as reticulate and the session list UI, but nothing has regressed there and
it is another series to maintain and threshold.

### The data explorer scenario does not start a session

The duckdb worker backs CSV and TSV files opened directly from the explorer, with no interpreter
involved. Opening a dataframe from a Python session is a different path that never touches the
worker, and its number would blend kernel memory, the dataframe itself, and the explorer UI. So
this scenario opens a CSV against a plain idle app, and its delta is measured against idle rather
than session.

### The assistant scenario is gated on a probe

The epic cites roughly 200 MB for the Copilot tokenizer. The agent host is already 80 MB at idle.
Either the tokenizer is inside that 80 MB, in which case idle covers it and there is nothing to
add, or it loads on first request, in which case a scenario is worth having. Run a one-off probe
that issues a single chat request and watches the agent host. If it does not grow, drop the
scenario and record why, so the question does not come back.

## How the scenarios relate

Features never share a launch. Each feature scenario is a cold launch that reaches exactly one
feature state, so its cost is `scenario_total - baseline_total` and a regression lands on one
series. A cumulative walk through session, then CSV, then cell run, then plot would be cheaper, but
every number after the first would depend on the order, and one flaky step would lose the chain.

## Settle protocol

Each scenario asserts the state it claims to measure before snapshotting, then holds for the same
settle window idle uses (it recorded `settleMs` of 3112):

- `session-python` and `session-r`: the session reports Ready
- `data-explorer`: the grid has rows
- `notebook`: the cell has output
- `plots`: the plot is in the pane

No fixed sleeps standing in for a state check. A scenario that cannot assert its own state does not
go on the list.

## Shape of the work

No new collector. Each scenario is a spec file plus a settings fixture, reusing `captureSnapshot`,
the labeling rules, and the renderer. `MEMORY_SCENARIO` already exists in the workflow and already
gates collection in `playwright.config.ts`. Snapshots gain a `scenario` field so
[#15495](https://github.com/posit-dev/positron/issues/15495) can carry one series per scenario.

All six scenarios in one job comes to roughly 31 to 35 minutes of the 45 minute budget. That fits,
but not with much room. Past three scenarios, split the job into a matrix keyed on
`MEMORY_SCENARIO`. That re-pays the 6.5 minute setup per job and runs them in parallel, which puts
wall clock back around 10 minutes and takes the timeout risk off the table.

## Out of scope

- **Thresholds and failures.** Report only, same as idle, until #15496 has variance history per
  scenario.
- **The 155 MB `electron-nodejs (index.js)`.** It is the fourth largest process at idle and is not
  attributed to any extension, which makes it a bigger open question than anything on this list. It
  belongs to [#15494](https://github.com/posit-dev/positron/issues/15494), and no new scenario
  would answer it.
- **The server lane.** [#15493](https://github.com/posit-dev/positron/issues/15493) owns it. These
  scenarios are defined against the Electron tree.

## One thing worth watching

Idle numbers depend on the workspace. The current run opens `test-files`, which contains a
`DESCRIPTION`, `.qmd` files, and a `pyproject.toml`, so the `workspaceContains` activation events
for air, Quarto, and ruff all fire. That is a reasonable choice, since it resembles a real project,
but it means a change to the fixture workspace can move the total without any code changing. Worth
remembering when the first unexplained jump shows up.
