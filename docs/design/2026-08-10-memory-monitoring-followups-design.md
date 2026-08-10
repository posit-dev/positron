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
| Quarto LSP, duckdb worker, ruff, air | Bytes yes, names no. They sit inside `language_server` 97.2 MB and `extension_child` 71.5 MB, anonymous |
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

**Role resolution** keeps today's precedence unchanged: `NAME_RULES`, then
`CMD_RULES`, then a new extension-path fallback to `extension_child`, then
`unlabeled`. The fallback is last, so it can only catch what nothing else claimed;
`ruff`, `air` and `jsonServerMain` keep `language_server`. One widening: `/lsp/`
joins the language-server patterns so Quarto's `out/lsp/lsp-*` resolves as
`language_server` rather than falling through.

**Name derivation** is new and pure: an argv containing `/extensions/<id>/` yields
`<id>`, with the version suffix stripped by the same regex `normalizeProcessName`
already applies. Where the executable basename differs from the id it is appended,
so `positron-python (pet)` and `quarto.quarto (lsp)` do not collide in a diff.

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
the deck asks people to stop growing, and roughly 32 rows would bury the process
tables in the same summary.

**Baseline dependency.** `publish.ts:190` requests only `extension_id` from the
baseline endpoint and `publish.ts:219-221` reconstructs it with `activationEvent:
null`. A "newly eager" diff needs to know how baseline extensions activated, so the
select list and the mapping both widen to carry `activation_event`. The API already
stores that column.

If a deployed endpoint does not return it, the section degrades to a count with no
newly-eager list. It must not fail the run.

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

## Risks

**The heap attributor may be larger than one item.** Mitigated by the spike, which
is the first thing B1 does.

**Part A's fallback could be misread as license to infer roles.** Mitigated by
stating the naming-versus-grouping distinction in the #15001 design doc alongside
the existing rule, not only here.

**The baseline endpoint may not return `activation_event`.** Degrades to a count.

**Idle desktop stays the only scenario until B2 lands**, so the first weeks of
nightlies cannot see kernel memory at all. This is a known and accepted gap, not a
surprise.
