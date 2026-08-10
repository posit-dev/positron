# Memory monitoring follow-ups

Follow-on design for posit-dev/positron#15001.

Date: 2026-08-10
Status: approved, ready for implementation planning

## Why

"Positron the Memory Hog" (Jonathan McPherson, 2026-07-30) measured the thing
#15001 was built to watch, and measured it by hand. Comparing the deck's findings
against what the harness surfaces shows the harness catches the right shape and
names none of the culprits.

The deck's findings:

| Finding | Figure |
| --- | --- |
| Ext host, upstream `vscode-server` | 126 MB |
| Ext host, `positron-server` | 638 MB (Kallichore and Ark on top) |
| Culprit 1: eagerly started child processes | Quarto LSP 101 MB, duckdb worker 86 MB, pet 9 MB, air 3 MB |
| Culprit 2: extension code retained in the ext host | copilot 82 MB, posit.assistant 20 MB, quarto 17 MB, catalog-explorer 13 MB |
| The ask | start processes lazily, shut them down, watch bundled code size, stop using `onStartupFinished` |

Against our final measurement (run 31404147221, 1.74 GB across 14 roles):

| Deck finding | Surfaced today |
| --- | --- |
| Total footprint creeping up | Yes. 2.5% launch spread is sensitive enough |
| Ext host as a bucket | Yes. `extension_host` 475.2 MB, same shape as the deck's 437.8 MB reachable heap |
| Quarto LSP, ruff, air | Bytes yes, names no. They sat inside `language_server` 97.2 MB and `extension_child` 71.5 MB, anonymous. Part A names them |
| duckdb worker | Not running at all in idle desktop. See Findings |
| Per-extension attribution | No. Explicit non-goal of #15001 |
| `onStartupFinished` growth | Parsed and stored, never rendered |
| Kallichore and Ark | No. `startupBehavior: manual` means no kernel starts |
| The 5x versus upstream | No. We diff against the previous Positron nightly, so a standing gap is invisible |
| Server topology | No. Electron desktop only |

The pattern: #15001 is built to catch growth that is *new*, and the deck is about
growth that is *already there*. Nothing in the deck invalidates the design. The gap
is in what the report says, and in what the idle desktop scenario can see at all.

An upstream `code-server` comparator was considered and dropped. It would keep the
5x ratio honest, but it is a second build to download and maintain for a number
that changes slowly and that nobody would act on differently than they would act on
the absolute figure.

## Part A: fold into #15001

Two changes, both inside files already in that PR, both raising the value of the
first nightlies rather than adding new collection.

### A1. Name the eager servers

Today a reader sees `language_server 97.2 MB` and cannot tell that most of it is
Quarto. The bytes are already collected; only the label is missing.

Split one concept into two, because they have different failure modes and different
blast radii.

**Role resolution** is `NAME_RULES`, then `CMD_RULES`, then `GENERIC_NAME_RULES`,
then an extension-path fallback to `extension_child`, then `unlabeled`. The fallback
is last, so it can only catch what nothing else claimed; `ruff`, `air` and
`jsonServerMain` keep `language_server`. `/lsp/` joins the language-server patterns
so Quarto's `out/lsp/` server resolves as `language_server`.

`GENERIC_NAME_RULES` is new and is the one precedence change. `electron-nodejs` moved
out of `NAME_RULES` into it, because `electron-nodejs (lsp.js)` names a runtime and a
script but not an owner. Consulted after argv rather than before, a generic name can
no longer outrank a specific identification. This moved 60 MB of Quarto from
`extension_child` to `language_server`, which is a one-time discontinuity in a
grouping key and costs nothing only because nothing has published yet.

**Name derivation** is new and pure: an argv token under a path segment beginning
`extensions` yields the id, with the version suffix stripped by the same regex
`normalizeProcessName` already applies. Where the executable basename differs from
the id it is appended, so `positron-python (pet)` and `quarto.quarto (lsp)` do not
collide in a diff.

Matching any segment beginning `extensions` rather than a list of known names is
deliberate. A first attempt enumerated `extensions` and `extensions-dir` and shipped
a labeler that silently missed everything in `extensions-dir-memory`, which is the
dir this scenario actually uses.

This bends the rule stated in the #15001 design ("any pressure to add cleverness to
labeling should be resisted in favour of adding a row to the map"). The rule
survives, with a distinction that should be written down: the cleverness is in
*naming*, which is display-only and cannot corrupt a grouping key. `process_role`
stays a dumb ordered list. A future contributor should read the fallback as a way to
avoid unnamed rows, not as license to infer roles.

Derived names are also more stable than today's normalized command lines, which is
the same property that stopped processes looking newly appeared every night.

**Top processes table.** The step summary gains a table of the top processes by PSS,
keyed on `process_name` with the same baseline delta the role table carries. This is
what makes the naming work visible without opening the HTML artifact.

### A2. Render startup activations

The only handle the harness gets on Culprit 2. Copilot and the Snowflake SDK share
one process, so no amount of process detail separates them, but "extension host grew
38 MB and `posit.catalog-explorer` is newly eager" is a lead. It is also the section
that makes `onStartupFinished` growth visible, which is the deck's closing ask.

Eager is defined as `activationEvent` in {`onStartupFinished`, `*`}, derived from a
field already stored, so there is no schema change.

The `startup: true` boolean the activation log line carries was considered and
rejected. It is VS Code's own notion of startup activation and is arguably the
better signal, but it also trips on activation races, which would make the section
noisier without making it more actionable. The regex keeps discarding it.

The section lists eager activations only. Demand-activated extensions are not what
the deck asks people to stop growing, and roughly 36 rows would bury the process
tables in the same summary.

Entries are grouped by event, worst first, one id per line. A single comma-separated
run of 15 ids wrapped mid-name and was unreadable, and it hid the distinction that
matters most: `*` does not wait for startup to finish, so it delays the window rather
than merely costing memory once it is up. Three extensions use it today.

**Baseline dependency.** The baseline response type carried only `extension_id`, and
`baselineToSnapshot` reconstructed every extension with `activationEvent: null`. A
"newly eager" diff needs to know how baseline extensions activated, so the response
type and the mapping both widen to carry `activation_event`, which Part C stores.

`activation_event` is optional on the wire. If an endpoint does not return it, the
section degrades to a count with no newly-eager list. It must not fail the run.

### Publishing is off until Part C

The `/memory` endpoints do not exist. `publishingEnabled()` gates both the POST and
the baseline GET on `MEMORY_PUBLISH=true`, defaulting off, and the workflow sets it
to `'false'` explicitly so the switch is visible where someone will look for it.

Failing soft was not sufficient on its own. A POST that errors and a POST to an
endpoint nobody has written produce the same log line, so an absent endpoint could
sit unnoticed behind something that reads like ordinary noise. Turning it on is one
line in the workflow once Part C lands.

### Testing

Both changes are pure functions over data the snapshot already carries, covered by
the existing `label.vitest.ts` and `render.vitest.ts` with fixtures built from the
real Quarto, duckdb, air and pet command lines. No new test infrastructure.

## Part B: follow-up spec

One spec covering three items, implemented in the order below.

### B1. Per-extension heap attribution

The item that replaces inference with `ext:copilot 82 MB`, and the only one that
answers the deck's largest single number.

The plumbing exists. `scripts/chat-simulation/common/utils.js:340`
(`connectToExtHostInspector`) is a working, dependency-light CDP client for the
extension host; `--inspect-extensions` already reaches the e2e launcher through
`extraArgs` (`test/e2e/infra/electron.ts:91`); `@vscode/v8-heap-parser` is already a
dependency and already installed in CI. The snapshot itself follows the chunk
accumulation in `scripts/chat-simulation/test-chat-perf-regression.js:763-772`.

The attributor is new and carries the whole risk. Nothing in the repo maps heap
nodes to extensions. `extensionHostProfiler.ts:38-91` shows the technique CPU
profiles use, a URI trie over each extension's `extensionLocation` matched against
script URLs, and heap snapshot nodes carry script URLs too, so it transfers
conceptually. The accounting does not: `@vscode/v8-heap-parser` exposes only
`get_class_counts`, which is counts by class rather than retained bytes by owner,
and a dominator tree means walking the nodes and edges arrays directly.

**This spec starts with a spike**: take one snapshot from a real build and establish
whether retained-size-by-script is reachable through the existing parser or requires
our own graph walk. The answer changes the size of the item substantially, and it is
roughly a day to find out versus designing around a guess.

### B2. Kernel scenarios

`idle+python` and `idle+R`. A settings change, a session start, and a new `scenario`
key, which the schema already carries. Closes the Kallichore and Ark blind spot the
deck calls out explicitly, and the existing `kernel` and `kernel_supervisor` roles
already exist to receive them.

### B3. Server lane

A second target for a collector that already exists, with its own baseline series.

This is the only item that measures the topology the deck is about: the 638-versus-126
figure and the Workbench and Posit Cloud sizing pain are both remote extension host.
It is sequenced last anyway, because attribution is useful on either topology, and a
server lane without attribution relocates the same blind spot rather than closing it.

## Part C: the /memory endpoints

The server side, on the e2e-test-insights API. It does not exist yet, which is why
Part A ships with publishing switched off.

Scope:

- `POST /memory`, one batched request per run. The client contract is already
  written and typed as `MemoryPayload` in `test/e2e/utils/memory/publish.ts`,
  including `payload_version: 1`, so this implements a specified interface rather
  than inventing one.
- `GET /memory/baseline?scenario=idle&branch=main`, returning the median launch of
  the most recent main nightly. `{ "found": false }` with a 200 when there is no
  baseline yet: that is a normal first-run state, and a 404 is indistinguishable
  from a typo in the path.
- The `memory_processes` and `memory_extensions` tables, both specified in the
  #15001 design. `memory_extensions` must carry `activation_event`, which the
  newly-eager diff reads back.
- The dashboard Memory sub-tab, also already specified there.
- Flip `MEMORY_PUBLISH` to `'true'` in the workflow.

### Sequencing

Part C is the one item with a cost for being late. Until it lands, every nightly
renders a report, attaches it, and throws the data away; there is no history, so no
trend, and the Change column stays empty because there is no baseline to fetch. Parts
A and B are both useful without it, but neither accumulates anything.

That argues for Part C before B1, despite B1 being the more interesting work: the
heap attributor produces a number per extension per run, and those numbers are worth
much more as a series than as a single reading. The counter-argument is that Part C
is the only part in another repo, so it may not be the same person's to schedule.

## Findings from the first two runs

Part A was verified against runs 31414067133 and 31416984861. Three things surfaced
that change what the later parts should assume.

**The duckdb worker does not run in idle desktop.** Twenty processes, none of them
duckdb. One of the deck's two headline child processes, 86 MB, is outside everything
this harness currently measures. It is presumably server-side or demand-started.
Evidence for B3, and a limit on what "idle" can claim to cover.

**Quarto's language server runs without Quarto activating eagerly.** It is there at
60 MB in every launch, and `quarto.quarto` is not in the eager list. Something starts
that server by a path the activation log does not record as an eager activation. The
deck's closing advice, stop using `onStartupFinished`, would not have caught it. This
is worth understanding before leaning on the eager section as the handle on Culprit 1,
and it may mean the section needs a companion signal.

**Copilot cannot appear in the eager list.** All 15 eager activations are builtins,
because a fresh extensions dir has no marketplace extensions. The deck's largest heap
number, copilot at 82 MB, is invisible to this harness by construction. The section
catches Positron adding an eager builtin, which is a real regression class, but it
does not reflect what a user's session costs. B1 does not have this limitation only
if the scenario installs the extensions worth measuring, which is a question B1 has to
answer rather than inherit.

## Risks

**The heap attributor may be larger than one item.** Mitigated by the spike, which
is the first thing B1 does.

**Part A's fallback could be misread as license to infer roles.** Mitigated by
stating the naming-versus-grouping distinction in the #15001 design doc alongside
the existing rule, not only here.

**The baseline endpoint may not return `activation_event`.** Degrades to a count.

**The eager list may not be the handle on Culprit 1 that Part A assumes.** Quarto's
language server runs at 60 MB in an idle session while `quarto.quarto` does not
appear in the eager list at all. See Findings.

**Idle desktop stays the only scenario until B2 lands**, so the first weeks of
nightlies cannot see kernel memory at all. This is a known and accepted gap, not a
surprise.
