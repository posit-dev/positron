# Phase 2 handoff: Quarto shadow bridge language features

Branch `feature/quarto-shadow-notebook`, on top of Phase 1 (see `HANDOFF-PHASE1.md`
for the shadow notebook core; everything there still holds except one correction
noted below). Phase 2 adds position mapping and bridge providers so users get
real language features inside the .qmd text editor, forwarded to language
servers through the shadow notebook's cell models.

## What exists

For a request at a `.qmd` position, a bridge provider (registered core-side for
the `quarto`/`rmd` language ids) resolves the code cell under the position,
translates the position into cell coordinates, invokes the real providers
registered for the cell's materialized `ITextModel` via
`ILanguageFeaturesService.<registry>.ordered(cellModel)`, and translates the
results back into `.qmd` coordinates. Requests in prose or on fence lines return
`undefined`, so prose features stay with the Quarto extension. Gated live per
request on `quarto.shadowNotebook.enabled` (no provider churn on toggle).

Proven end-to-end by the ext host suite: `vscode.executeCompletionItemProvider`
/ `executeHoverProvider` on a `.qmd` at an in-cell position reaches a real
`vscode-languageserver` (which sees the `vscode-notebook-cell` URI at cell
coordinates) and surfaces its results mapped back to `.qmd` coordinates.

## Provider status

| Feature | Status | Merge semantics / notes |
|---|---|---|
| Completions | Done | All providers merged; `incomplete` ORed; disposes aggregated; `resolveCompletionItem` round-trips through the originating provider in cell space. Missing `range` passes through (suggest fills the default word range on the .qmd - already document space). |
| Hover | Done | Contents of all providers concatenated into one hover (the bridge holds a single provider slot); first defined range wins. Verbosity (`canIncrease/DecreaseVerbosity`, hover context) deliberately dropped: a verbosity request round-trips the previous hover in provider space, and the merged hover is not any single provider's. |
| Signature help | Done | First non-null result in score order (same semantics as the parameter hints widget); losers/cancelled results disposed. No positions in the payload; guard is a backstop. |
| Definition | Done | All providers, flattened to `LocationLink[]`. Same-document cell targets map to the .qmd; cells of ANOTHER open .qmd map to that document; real files pass through; unmappable shadow cells dropped with a log line. `originSelectionRange` maps via the request cell, `targetSelectionRange` via the target's cell. |
| References | Done | All providers, flattened; same location mapping as definition. |
| Code actions | Done | All providers merged. Workspace edits on shadow cells rewritten onto the .qmd URI (applying them edits the real document - never the shadow); edits on other resources pass through; unmappable cell edits dropped. Diagnostics/ranges translate via the request cell. `resolveCodeAction` delegates and translates the filled-in edit. |
| Document highlights | Done (single-cell scope) | First non-empty result, matching the word-highlighter. Highlights cover the request cell only; occurrences in the document's OTHER cells would need the `multiDocumentHighlightProvider` registry - out of scope, noted in code. |

## Key file map (all new unless noted)

- `src/vs/workbench/contrib/positronQuarto/common/quartoPositionMapping.ts` -
  pure line/position/range mapping keyed off `QuartoCodeCell.codeStartLine`
  (cells are verbatim slices; columns 1:1). The column identity relies on the
  parser only recognizing column-0 fences (`CODE_START_REGEX` anchors at line
  start, so an indented fence never becomes a cell); documented in the module
  JSDoc and pinned by a test that parses an indented fence.
- `common/quartoShadowUriLeakGuard.ts` - the leak guard (below).
- `browser/quartoShadowLanguageBridge.ts` - `QuartoShadowLanguageBridge`:
  request resolution (`resolveRequest`), location back-mapping
  (`mapLocationToDocument`), and `invokeSafely` (one failing provider never
  sinks a request).
- `browser/quartoShadowCompletionProvider.ts`, `browser/quartoShadowCodeActionProvider.ts` -
  ports of Davis Vaughan's spike providers (spike-ref/davis-quarto), adapted
  from his `quarto-cell:` models to the shadow notebook cells.
- `browser/quartoShadowLanguageFeatureProviders.ts` - hover, signature help,
  definition, references, document highlights.
- `browser/quartoShadowLanguageFeatures.contribution.ts` - registers all
  providers once for `QUARTO_LANGUAGE_IDS`; imported from
  `positronQuarto.contribution.ts` (modified).
- `browser/quartoShadowNotebookService.ts` (modified) - new
  `getCellTextModel(resource, cellHandle)` on `IQuartoShadowNotebookService`.
- `browser/quartoShadowNotebookSync.ts` (modified) - `_ensureCellTextModel`
  promoted to public `getOrCreateCellTextModel` (callers must never edit the
  returned model; sync is one-way).

## The leak guard

Invariant (spike plan.md section 8.5): no `vscode-notebook-cell:` URI of a
shadow notebook may leak into user-facing results. Design:

- **Identification is path-based and pure**: a shadow cell URI is
  `scheme === 'vscode-notebook-cell' && isQuartoOrRmdFile(uri.path)` (cell URIs
  share their notebook's path, and shadow notebooks are the only notebooks whose
  resource is a .qmd/.rmd). Cell URIs of real notebooks (.ipynb) are legitimate
  user-facing locations and pass untouched.
- **Deep scan, not per-provider field knowledge**
  (`findShadowCellUriLeak`): walks arrays/Maps/Sets/objects, detects both `URI`
  instances and plain `UriComponents`-shaped objects (e.g. an
  `IMarkdownString.uris` record), cycle-safe, node-budget-capped (10k).
- **`command` keys are skipped**: command payloads round-trip to the extension
  that produced them, where cell URIs are the native coordinate space (e.g. an
  LSP auto-import command's arguments). Rewriting or dropping them would break
  the feature; the workbench never opens/edits them directly.
- **Fail closed**: every provider passes its final result through
  `guardAgainstShadowCellUriLeaks(feature, result, log)` just before returning;
  on a leak the whole result is dropped and an error logged. Tested as its own
  class (`test/common/quartoShadowUriLeakGuard.vitest.ts`) plus a provider-level
  backstop test (a hover smuggling a cell URI through markdown `uris` is
  dropped).

Translation itself (the guard is only the backstop) rewrites shadow cell URIs
via `QuartoShadowLanguageBridge.mapLocationToDocument`: parse `CellUri`, find
the notebook cell by handle, map to the parse cell at the same index, translate
the range with `toDocumentRange`. Unmappable shadow cell URIs are dropped (never
surfaced raw).

## Deviations from the brief / Phase 1 handoff, with reasons

- **Phase 1 handoff correction: `ITextModelService.createModelReference(cellUri)`
  is NOT safe for unmaterialized cells.** `CellContentProvider.provideTextContent`
  short-circuits to an existing `IModelService` model, but when none exists it
  resolves the notebook through `INotebookEditorModelResolverService` - the
  exact forbidden path (working copy wrap, dirty hazards, disposal on reference
  expiry). Instead, Phase 2 exposes the sync's own materialization as
  `IQuartoShadowNotebookService.getCellTextModel(resource, cellHandle)`, which
  shares the cell's text buffer with no resolver involvement. Phase 3: use this
  method, not `createModelReference`, for cell models.
- **Trigger characters are a static superset** (`['.', '$', ':', '@']` for
  completions; `['(', ',']` for signature help), extending Davis's
  `['.', '$', ':']` with `@` (R S4 slot access). Reason documented in code: the
  suggest controller collects trigger characters per model, but a .qmd model
  hosts cells of several languages at once, so a per-request dynamic set is
  impossible; over-triggering only costs a request the underlying provider
  answers empty.
- **Cell correlation is same-instant index correspondence** (parse cell `i` <->
  notebook cell `i`), guarded by a language equality check for the brief window
  where a structural reparse races the sync. This does not violate the "never
  key by index across parses" rule: nothing is persisted by index; the
  `WeakMap`-based resolve bookkeeping keys by item identity and carries the
  `QuartoCodeCell` snapshot from request time.
- **Known staleness window (~100ms, accepted)**: `QuartoDocumentModel` reparses
  on a 100ms debounce, so a request racing a keystroke sees cell content/line
  numbers from the previous parse. Within-line edits don't shift line numbers,
  and the suggest widget filters by the current word client-side, so in practice
  completions feel correct; this is the same class of latency any
  debounced-mirror bridge has. If it ever matters, add a `flush()` to
  `QuartoDocumentModel` and call it from `resolveRequest`.

## Tests

Vitest (all under `src/vs/workbench/contrib/positronQuarto/`): 49 new tests, 307
total for the directory.

- `test/common/quartoPositionMapping.vitest.ts` (9) - round trips, fence
  exclusion, empty cells, column-0 invariant.
- `test/common/quartoShadowUriLeakGuard.vitest.ts` (9) - identification,
  nesting, containers, UriComponents shape, command-key skip, cycles, fail-closed.
- `test/browser/quartoShadowLanguageFeatures.vitest.ts` (16) - hover /
  signature help / definition / references / highlights: forwarding with
  translated positions, prose/fence undefined, multi-language routing, hover
  merge, setting toggle (live), no-shadow fallback, cross-document mapping,
  unmappable drops, leak-guard backstop, LocationLink selection ranges.
- `test/browser/quartoShadowCompletionProvider.vitest.ts` (9) - range +
  insert/replace + additionalTextEdits translation, missing-range passthrough,
  multi-provider merge (incomplete OR, dispose aggregation), provider-throw
  resilience, R+Python routing, resolve round-trip in cell space.
- `test/browser/quartoShadowCodeActionProvider.vitest.ts` (6) - range
  forwarding, workspace-edit rewrite (.qmd + passthrough + unmappable drop),
  diagnostics/ranges, resolve delegation.

Test-harness gotcha worth knowing: stub providers registered for
`{ language: 'python' }` only match if `python` is a REGISTERED language id in
the container (`ctx.get(ILanguageService).registerLanguage({ id: 'python' })` in
`beforeEach`) - otherwise the materialized cell model silently falls back to
`plaintext` and `ordered(cellModel)` returns nothing. The same applies to the
ext host harness: the test extension's `package.json` now contributes the
`quarto` language (with `.qmd`) and a bare `python` id, because the harness runs
with built-in extensions disabled. It remains test-only/never shipped.

Ext host (`extensions/quarto-shadow-notebook/`): 4 new tests in
`src/test/languageFeatures.test.ts` (11 total with Phase 1's) - real
languageclient/server; completions and hover reach the server at cell
coordinates with the cell URI and come back at .qmd coordinates; prose and fence
requests never hit the server.

```bash
# Vitest (no build needed)
npx vitest run src/vs/workbench/contrib/positronQuarto/
npm run test:positron:check-ts     # no quartoShadow*/quartoPositionMapping errors

# Extension host (needs compiled out/ + the test extension compiled)
npm run build-start && npm run build-check
cd extensions/quarto-shadow-notebook && npx tsc -p ./tsconfig.json && cd ../..
API_TESTS_EXTRA_ARGS="--disable-telemetry --disable-experiments --skip-welcome \
  --skip-release-notes --no-cached-data --disable-updates --use-inmemory-secretstorage \
  --disable-extensions --disable-workspace-trust --user-data-dir=/tmp/qsn-udd" \
  npm run test-extension -- -l quarto-shadow-notebook
```

Build state: `npm run build-check` still reports only the pre-existing
`positronAiProvider`/`positronHeadlessLanguageModel` errors (6) and the
`watch-e2e` missing-optional-dep errors (4); zero errors in Phase 2 files.
`npm run valid-layers-check`'s `layersChecker.ts` step passes; the subsequent
`tsgo --project build/checker/*` steps emit repo-wide pre-existing TS6142
`--jsx` noise on `.tsx` files, none referencing Phase 2 files. Commits remain
unsigned (`-c commit.gpgsign=false`), same as Phase 1.

## What Phase 3 (diagnostics re-projection + Problems pane suppression) needs

- **Where markers land today**: servers push per-cell diagnostics against the
  `vscode-notebook-cell:` URIs; they reach `IMarkerService` (and
  `vscode.languages.getDiagnostics(cellUri)` - asserted by Phase 1's ext host
  test) and are VISIBLE in the Problems pane under cell URIs ending in `.qmd`.
  Phase 3 owns re-projection (subscribe to `IMarkerService.onMarkerChanged`,
  filter with `isShadowCellUri` from `quartoShadowUriLeakGuard.ts`, translate
  ranges with `mapLocationToDocument`/`toDocumentRange`, `changeOne` onto the
  .qmd resource under a dedicated owner) and suppression of the raw cell-URI
  markers in the pane.
- **Marker gotcha from the spike** (commit 40581f8 on spike-ref/davis-quarto,
  `quartoCellDiagnostics.ts`): do NOT call `markerService.changeOne()` from
  inside an `onMarkerChanged` handler - the change gets cleared after the
  current round of handlers runs. Defer the re-projection (e.g. microtask /
  `setTimeout 0`) before pushing translated markers.
- **Mapping helpers ready to reuse**: `quartoPositionMapping.ts` (pure),
  `QuartoShadowLanguageBridge.mapLocationToDocument` (URI+range, cross-document,
  drop-on-unmappable), `isShadowCellUri` (pure). Cell handle -> parse cell goes
  through the same-instant index correspondence; on every reparse markers must
  be re-projected anyway (line numbers move), so listen to the document model's
  `onDidParse` as well as `onMarkerChanged`.
- **Cell text models**: get them via
  `IQuartoShadowNotebookService.getCellTextModel(resource, handle)`; never
  `createModelReference` on a cell URI (resolver hazard, see deviations), and
  never edit them.
- **Code action context**: when re-projected .qmd markers exist, code action
  requests on the .qmd will carry those markers, while the cell providers
  compute their own from the cell URI markers - today the bridge forwards the
  request context unchanged, which stays correct. If Phase 3 SUPPRESSES the
  cell-URI markers (rather than just re-projecting), verify ext-host code
  action providers still see the server's diagnostics (they read from the
  extension-side diagnostics collection keyed by cell URI, which suppression
  must not touch - suppress presentation, not the marker data, or filter only
  the Problems pane surface).
- **No bundled server targets the shadow yet**: the `quarto-shadow` notebook
  selector still only exists in the test server; enabling
  ruff/pyrefly/positron-python/ark for the shadow type (plus Quarto extension
  coexistence) remains open, as noted in Phase 1's gaps.
