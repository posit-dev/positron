# Per-extension extension host heap attribution

Design for [#15494](https://github.com/posit-dev/positron/issues/15494), step 7 of
the memory metrics epic [#15001](https://github.com/posit-dev/positron/issues/15001).

## Problem

The nightly harness attributes memory per process. That works for anything with
its own process: `label.ts` names the duckdb worker, Ark, the Quarto language
server and ruff after the extension that spawned them.

Every extension shares one extension host process, so the report has a single
`extension_host` row (336 MB at idle, the second largest after the renderer) and
cannot say which extension owns any part of it.

Two of the four regressions #15001 was filed over live in that row: Copilot
loading its tokenizer at startup, and the catalog explorer loading the Snowflake
SDK. Both are invisible today. So is [#15558](https://github.com/posit-dev/positron/issues/15558),
where `positron-python` retained ~35 MB of PyPI index in the `notebook` scenario
and it took a manual DevTools session to find.

A feasibility spike (2026-08-31) confirmed the mechanism works and attributed
120.5 MB to `copilot` in about a minute.

## Goals

Add a per-extension breakdown of the extension host heap to every nightly
scenario, in the run report and in the published payload, without changing any
existing measurement.

## Non-goals

- **Alerting or thresholds.** #15496 owns that, and it should not consume these
  numbers until their launch-to-launch spread is known.
- **A dashboard card.** Planned, but it lives in the e2e-test-insights repo and
  ships as its own PR there. This spec covers only the Positron side: the payload
  is shaped so the card needs no further Positron-side change. Build it after the
  first few nights, so the plotted series can be scaled to the real spread.
- **A standalone CLI or a manual runbook.** Considered and dropped: the nightly
  table answers the question, and Chrome DevTools remains available for anyone
  who needs a retainer chain rather than a ranking.
- **Decomposing the unattributed remainder.** It is the extension host runtime
  and node internals, and is reported as a single figure.
- **Any product code change.** Everything lives in `test/e2e/utils/memory/`.

## Mechanism

Three steps, all over the CDP connection `gc.ts` already opens to the extension
host on port 5870.

**1. Resolve script ids to URLs.** `Debugger.enable` replays a
`Debugger.scriptParsed` event for every already-loaded script, giving
`scriptId -> url`. The replay completes before `enable` resolves (measured, see
Failure handling), so the map is ready with no wait.

**2. Map heap nodes to scripts.** The snapshot's `locations` array carries
`(object_index, script_id, line, column)` per located node. A node therefore
resolves to a script URL, and the URL's extension directory segment gives the
owner. In the spike, 304k of 607k located nodes resolved to an extension.

Extension directory extraction calls `deriveExtensionName()` in `label.ts`
rather than a second copy of its regex. It already handles the three directory
layouts the harness produces (`bundled/extensions/`,
`~/.positron-server/extensions/`, and the throwaway `extensions-dir-memory/`),
and strips the version suffix. It takes a command line today but matches on a
whitespace-delimited token, so a bare script URL works unchanged.

**3. Partition by dominator tree.** Function objects are tiny; the memory is in
what they retain, so self size alone accounts for only 2.7% of the heap. Building
the dominator tree and crediting every byte to its nearest owning ancestor gives
a true partition: no double counting, and the parts sum to the reachable heap.

The spike used the Cooper-Harvey-Kennedy iterative algorithm over a BFS ordering
and converged in 8 rounds on 3.7M nodes and 16M edges.

## Where it runs

**Capture per launch, parse once.** Each launch streams a snapshot to
`RUNNER_TEMP` immediately after PSS sampling completes, alongside the existing
snapshot JSON. Capture is about 5 seconds and 354 MB.

Parsing is deferred to the `Render report` step, which already reads the three
launch JSONs back off disk. This matters for two reasons: the parse needs several
GB of heap and must not run while Positron is being sampled, and deferring it
means parsing once per scenario instead of three times.

No artifact boundary is crossed. `Render report` is a step in the same `memory`
job as the launches, so `RUNNER_TEMP` still holds the files. (The separate
`summarize` job downloads only the rendered reports.) Nothing new is uploaded.

Peak disk is three snapshots for one scenario, about 1.1 GB: the matrix gives
each scenario its own runner, and each file is deleted as soon as it is parsed.
The parse also checks `snapshot.meta.node_fields` and `location_fields` against
what it expects before reading, so a V8 format change from a Node bump surfaces
as a skipped breakdown rather than silently wrong numbers.

Capture must come after `captureSnapshot`, never before. The forced GC in `gc.ts`
already ran by then, so the heap is post-collection and free of the startup
garbage that made pre-GC figures swing.

Snapshot files are deleted after parsing. They are never uploaded: 354 MB per
launch is not worth retaining when the derived rows are a few hundred bytes.

## Extension identity

The script path yields a directory name (`copilot`, `positron-python`). The
report and payload use the real extension id (`GitHub.copilot-chat`,
`positron.positron-python`), resolved by reading `publisher` and `name` from each
extension directory's `package.json`.

Resolved at capture time, while the app's extension directories are still on
disk, and carried to the parse in the snapshot's sidecar: the render step runs
after the app is gone and a temp extensions dir with it.

Real ids are what people search for, and they join to the activated-extension
inventory `extensions.ts` already collects. A directory whose `package.json`
cannot be read falls back to the directory name rather than being dropped.

## Data model

`MemoryPayload` gains one array:

```ts
export type ExtensionHeap = {
    /** Real extension id, or the directory name if package.json was unreadable. */
    extensionId: string;
    /** Retained bytes, as a dominator-tree partition of the reachable heap. */
    retainedBytes: number;
};

export type ExtensionHeapBreakdown = {
    extensions: ExtensionHeap[];
    /** Extension host runtime and node internals. Not any extension's. */
    unattributedBytes: number;
    /** Reachable heap total; extensions + unattributed must equal this. */
    reachableBytes: number;
};
```

`ExtensionHeapBreakdown` attaches to the per-launch snapshot as an optional
`extensionHeap`, written by the render step rather than at capture time. It is
not the existing per-launch `extensions: ActivatedExtension[]`, which is the
activation-log inventory of what loaded; this is a heap partition of what those
extensions retain. An extension can appear in one and not the other.

Every extension is published, not a top N. The array is small and letting the
consumer choose a cutoff avoids a second Positron-side change when the dashboard
lands.

This is the contract with the e2e-test-insights repo, so the `/memory` endpoint
must accept the new field before this ships. It is additive and optional, so an
older endpoint ignores it rather than rejecting the run.

## Report

The markdown and HTML reports gain a second summary table below the existing
`| Role | PSS | Change |` table, decomposing the `extension_host` row:

```
### Extension host heap: notebook

| Extension                    | Retained | Change   |
| ---------------------------- | -------- | -------- |
| `GitHub.copilot-chat`        | 120.5 MB | +0.3 MB  |
| `positron.positron-python`   |  37.6 MB | +35.0 MB |
| `vscode.authentication`      |   2.8 MB | flat     |
| (14 others)                  |   1.3 MB | flat     |
| _unattributed_               | 192.8 MB | +3.6 MB  |
```

`Change` uses the same baseline the role table already uses, via the existing
`fetchBaseline` path. `unattributed` is always shown: it is 59% of the heap, and
hiding it would imply the extensions sum to the extension host row.

Rows below 1 MB retained collapse into an "others" line, matching how the role
table already keeps itself readable. A fixed byte floor rather than a top N or a
percentage: it keeps a newly appearing extension visible the moment it matters,
and the spike's tail was 14 extensions under 0.2 MB.

`Change` reads `-` when there is no prior extension-level baseline, which is the
case on the first night and whenever an extension appears for the first time.
That is the same treatment the role table already gives a missing baseline, not a
failure.

## Failure handling

A failure in any step logs and omits the per-extension block. It never fails the
scenario.

PSS is the product of this harness; attribution is an addition. Losing a night's
idle datapoint because an inspector was unreachable or a parse ran out of memory
would be a bad trade. The report says the breakdown was unavailable and why,
rather than showing an empty table that reads as "no extensions".

One failure would be silent, so the parse checks for it directly: an incomplete
`scriptId -> url` map under-attributes without raising anything. The check is the
share of `locations` entries whose script id did not resolve. The parse skips the
breakdown above 1%, and skips it outright when `locations` is empty rather than
dividing by zero: an all-unattributed breakdown is indistinguishable from a
healthy run, so it is reported as unavailable like any other capture failure.

That is a ratio rather than an absolute script count on purpose. It is
self-normalizing across scenarios and platforms, it measures the thing that
actually matters, and it fails on any cause: a truncated map, a format change, an
inspector that dropped events. Two measurements put the healthy value at 0.013%
and 0.019%, so 1% is two orders of magnitude of headroom and fires only on gross
breakage.

An earlier draft also waited for a quiet period on `scriptParsed`, on the theory
that `Debugger.enable` resolves before the replay drains. An experiment
(2026-08-31, three CDP sessions against one extension host) refuted it: all 609
scripts were present when `enable` resolved, and none arrived in the following 10
seconds. The 609-vs-518 counts that suggested a race came from two different
launches, which legitimately had different code loaded. No wait is needed.

## Testing

Vitest, following the existing files in `test/e2e/utils/memory/`:

- Attribution over small hand-built snapshot fixtures: a known dominator shape
  partitions as expected, the parts sum to the reachable total, and unowned
  subtrees land in `unattributed`.
- Script-id resolution: URLs inside and outside extension directories, all three
  directory layouts, and an unresolvable script id.
- Extension identity: `package.json` present, absent, and malformed.
- Report rendering: the new table with a baseline, without one, and in the
  unavailable case.
- Failure handling: each failure mode leaves the rest of the payload intact, and
  a fixture with over 1% unresolved script ids skips the breakdown, as does one
  with an empty `locations` array.

The end-to-end path cannot be unit tested. It is verified by the first CI run,
which is also the first time the capture runs on Linux under Playwright.

## Risks

**Launch-to-launch spread is unknown.** The spike is one measurement on macOS.
If `copilot` swings tens of MB between launches, the series is diagnostic rather
than trendable, which changes what the dashboard card should plot and is the
reason to read a few nights before building it. The three existing launches per
scenario answer this on the first night.

**Attribution coverage is 41%.** Correct rather than incomplete, since the
remainder is genuinely not any extension's, but it means this cannot explain
every extension host movement.

**Spike numbers are not CI numbers.** macOS, fresh extensions dir, bootstrap
vsixes not warmed. The mechanism transfers; the absolute figures do not.
