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
- **A dashboard card.** Deferred until a few nights of data show whether the
  series is stable enough to plot. The payload is designed so this needs no
  further Positron-side work.
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
`scriptId -> url`.

**2. Map heap nodes to scripts.** The snapshot's `locations` array carries
`(object_index, script_id, line, column)` per located node. A node therefore
resolves to a script URL, and the URL's extension directory segment gives the
owner. In the spike, 304k of 607k located nodes resolved to an extension.

Extension directory extraction reuses `EXTENSION_PATH` in `label.ts` rather than
a second copy of that regex. It already handles the three directory layouts the
harness produces (`bundled/extensions/`, `~/.positron-server/extensions/`, and
the throwaway `extensions-dir-memory/`).

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

Parsing is deferred to the aggregation run that already renders the report. This
matters for two reasons: the parse needs several GB of heap and must not run
while Positron is being sampled, and deferring it means parsing once per scenario
instead of three times.

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

Rows below a small floor collapse into an "others" line, matching how the role
table already keeps itself readable.

## Failure handling

A failure in any step logs and omits the per-extension block. It never fails the
scenario.

PSS is the product of this harness; attribution is an addition. Losing a night's
idle datapoint because an inspector was unreachable or a parse ran out of memory
would be a bad trade. The report says the breakdown was unavailable and why,
rather than showing an empty table that reads as "no extensions".

One failure is silent and needs an explicit guard: `Debugger.enable` resolves
before the `scriptParsed` replay finishes. The spike saw 609 scripts on one run
and 518 on the next, which under-attributes without any error. Capture waits for
a quiet period with no new `scriptParsed` events and records the count, and the
parse rejects a run whose script count is implausibly low.

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
- Failure handling: each failure mode leaves the rest of the payload intact.

The end-to-end path cannot be unit tested. It is verified by the first CI run,
which is also the first time the capture runs on Linux under Playwright.

## Risks

**Launch-to-launch spread is unknown.** The spike is one measurement on macOS.
If `copilot` swings tens of MB between launches the series is diagnostic only,
not trendable, and the dashboard card should not be built. The three existing
launches per scenario answer this on the first night; read that before doing
anything further.

**Attribution coverage is 41%.** Correct rather than incomplete, since the
remainder is genuinely not any extension's, but it means this cannot explain
every extension host movement.

**Spike numbers are not CI numbers.** macOS, fresh extensions dir, bootstrap
vsixes not warmed. The mechanism transfers; the absolute figures do not.
