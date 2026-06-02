# Quarto Code-Cell Language Features (completions first)

## Context

A `.qmd` file is a single `TextDocument` mixing prose (Markdown) and fenced code cells
(`` ```{python} ``, `` ```{r} ``, ...). We want a clean division of LSP responsibility:

- The **Quarto extension** owns language features for the **prose**.
- **Positron** owns language features for the **code cells** (completions, then diagnostics,
  hover, definition, etc.), routed to the real per-language servers (positron-python's
  Pylance/Jedi, positron-r's Ark).

The mechanism: maintain one synthetic `ITextModel` per code cell, in the cell's language,
kept in sync with the `.qmd`. Synthetic models created via `IModelService` auto-sync to the
extension host as `TextDocument`s (so the language servers see `didOpen`/`didChange` and build
their indexes). We then register a completion provider for the `quarto`/`rmd` languages that,
on a request inside a code cell, **forwards** to the providers registered for that cell's
language and translates positions/ranges back into `.qmd` space. Requests in prose return
`undefined`, leaving them to the Quarto extension.

Decisions locked with the user:
- **Workbench layer** (`src/vs/`), reusing the existing parser and `QuartoDocumentModel`.
- **Extend** the existing `QuartoDocumentModel`/`QuartoDocumentModelService`; do not build a
  parallel cell-tracking system.
- **Completions first**, but factor the cell-document + position-translation layer so adding
  hover/diagnostics/definition later is additive, not a rewrite.

### Why this is viable (verified)
- `IModelService.createModel(value, languageSelection, uri, isForSimpleWidget=false)` produces
  a model that `MainThreadDocuments.handleModelAdded` mirrors to the ext host (the only filter
  is `shouldSynchronizeModel` = not-too-large + not-`isForSimpleWidget`; **no scheme filter**).
  See `src/vs/workbench/api/browser/mainThreadDocuments.ts` and
  `src/vs/editor/common/model.ts` (`shouldSynchronizeModel`).
- Ext-host-registered completion providers land in the **same** registry workbench code reads:
  `MainThreadLanguageFeatures.$registerCompletionsProvider` calls
  `ILanguageFeaturesService.completionProvider.register(...)`. So
  `completionProvider.ordered(cellModel)` returns the Python/R server providers, and invoking
  them with the cell model runs the real servers.
  See `src/vs/workbench/api/browser/mainThreadLanguageFeatures.ts`,
  `src/vs/editor/common/services/languageFeatures.ts`,
  `src/vs/editor/common/languageFeatureRegistry.ts`.

## Existing code to reuse

- Parser: `src/vs/workbench/contrib/positronQuarto/common/quartoParser.ts`
  (`parseQuarto`, `kernelToLanguageId`).
- Cell model: `src/vs/workbench/contrib/positronQuarto/browser/quartoDocumentModel.ts`
  already parses (debounced 100ms), tracks cells, fires `onDidChangeCells` / `onDidParse`,
  and exposes `getCellAtLine`, `getCellByIndex`, `getCellCode`, `cells`.
- Service: `.../browser/quartoDocumentModelService.ts` (`IQuartoDocumentModelService.getModel`).
- Types: `.../common/quartoTypes.ts` (`QuartoCodeCell` has 1-based `startLine`, `endLine`,
  `codeStartLine`, `codeEndLine`, `language`, `index`).
- Language ids + helpers: `.../common/positronQuartoConfig.ts` (`QUARTO_LANGUAGE_IDS`,
  `isQuartoDocument`).
- Contribution wiring: `.../browser/positronQuarto.contribution.ts`.

## Approach

### 1. Pure position/range mapping (new, fully unit-tested)
`.../common/quartoPositionMapping.ts`

Code chunk lines are verbatim and start at column 0, so only the line offset shifts; columns
are 1:1. Export pure functions keyed off a `QuartoCodeCell`:
- `toCellLine(cell, qmdLine)` -> `qmdLine - cell.codeStartLine + 1`
- `toDocumentLine(cell, cellLine)` -> `cellLine + cell.codeStartLine - 1`
- `toCellPosition(cell, position)`, `toDocumentPosition(cell, position)`,
  `toDocumentRange(cell, range)` (built on the line helpers, columns unchanged).
- `isInsideCellCode(cell, qmdLine)` -> `qmdLine >= codeStartLine && qmdLine <= codeEndLine`
  (excludes the fence lines, which are prose).

These are trivial to test exhaustively in `.../test/common/quartoPositionMapping.vitest.ts`.

### 2. Per-document cell model sync (new)
`.../browser/quartoCellModelSync.ts` -- `QuartoCellModelSync extends Disposable`, one per `.qmd`.

Takes an `IQuartoDocumentModel` + `IModelService` + `ILanguageService`. Maintains synthetic
cell `ITextModel`s and keeps them current:
- **Key cell models by cell `index`, not `id`.** `QuartoCodeCell.id` embeds a content hash and
  changes on every edit; index is stable for a fixed cell position. This avoids open/close
  churn at the language server (which would discard server-side state and flicker diagnostics).
- On `onDidParse` (fires every reparse), reconcile: for each cell index, ensure a model exists
  with the correct language (recreate only if the language changed), then `setValue(getCellCode(cell))`
  to refresh content; dispose models for indices beyond the current cell count.
- Create models with `modelService.createModel(code, languageService.createById(cell.language),
  cellUri, /*isForSimpleWidget*/ false)`.
- **Cell URI**: stable scheme + path that does NOT include the content hash, e.g.
  `quarto-cell:/<qmd-path>?cell=<index>` carrying the qmd path so the server can resolve relative
  imports the way notebook cells embed the notebook path (`CellUri` in
  `src/vs/workbench/contrib/notebook/common/notebookCommon.ts` is the precedent to mirror).
  Register the scheme constant in `positronQuartoConfig.ts`.
- Expose `getCellModel(cell: QuartoCodeCell): ITextModel | undefined` (lookup by index) and
  dispose all cell models on dispose.

A thin service `IQuartoCellModelService` (`.../browser/quartoCellModelService.ts`) owns a
`QuartoCellModelSync` per qmd uri (DisposableMap keyed by uri), created lazily and disposed when
the underlying text model disposes -- mirror the lifecycle pattern in
`quartoDocumentModelService.ts`.

### 3. Completion bridge provider (new)
`.../browser/quartoCompletionProvider.ts` -- implements `languages.CompletionItemProvider`
(from `src/vs/editor/common/languages.ts`).

`provideCompletionItems(qmdModel, position, context, token)`:
1. Resolve the `IQuartoDocumentModel` for `qmdModel.uri`; `cell = getCellAtLine(position.lineNumber)`.
2. If no cell or `!isInsideCellCode(cell, position.lineNumber)` -> return `undefined` (prose;
   the Quarto extension handles it).
3. `cellModel = quartoCellModelService.getCellModel(qmdModel.uri, cell)`; bail if absent.
4. `cellPosition = toCellPosition(cell, position)`.
5. `providers = languageFeaturesService.completionProvider.ordered(cellModel)` and call each
   `provideCompletionItems(cellModel, cellPosition, context, token)`.
6. Translate each suggestion's `range` (and `additionalTextEdits` ranges) back via
   `toDocumentRange(cell, ...)`; merge into one `CompletionList`, `incomplete` = OR of inputs.
7. To support `resolveCompletionItem`, tag each returned suggestion with its originating provider
   + cellModel and implement `resolveCompletionItem` on the bridge to delegate and translate the
   resolved edits back. (Different cell languages never collide because lookup is per-cell.)

Set `triggerCharacters` to a superset (e.g. `['.']`) so member-access completions fire; the bridge
re-derives the actual language from the cell at request time.

### 4. Wiring (extend existing contribution)
New `.../browser/quartoLanguageFeatures.contribution.ts`, imported from
`positronQuarto.contribution.ts`:
- Register `IQuartoCellModelService` as a singleton.
- Register the completion provider once for each id in `QUARTO_LANGUAGE_IDS`
  (`languageFeaturesService.completionProvider.register({ language: id }, provider)`).
- A small `IWorkbenchContribution` that, for every open quarto/rmd text model, ensures both the
  `QuartoDocumentModel` (via `IQuartoDocumentModelService.getModel`) and its `QuartoCellModelSync`
  exist so cell models stay live and synced while the doc is open (drive off
  `IModelService.onModelAdded`/`onModelRemoved` filtered by `QUARTO_LANGUAGE_IDS`, or
  `editorService`). Today models are created lazily by execution contributions; this guarantees
  cell models exist for language features even when nothing is executed.

## Key risk to verify early: language-server document selectors

`completionProvider.ordered(cellModel)` only returns a server's provider if the cell model
matches that server's registered `documentSelector`, and the client only forwards `didOpen` to
the server under the same selector. If positron-python / positron-r register scheme-restricted
selectors (e.g. `{ scheme: 'file', language: 'python' }` or notebook-cell only), our
`quarto-cell:` models won't match.

- Inspect the client selectors in `extensions/positron-python/` and `extensions/positron-r/`
  (`extensions/positron-r/src/lsp.ts` builds the `selector`; see also
  `extensions/positron-r/src/virtual-documents.ts`, which already registers a content provider
  for a custom scheme).
- If scheme-agnostic (`{ language: 'python' }`), no change needed.
- If scheme-restricted, add the `quarto-cell` scheme to those selectors (the same way
  notebook-cell support is added).

Validate this with a one-cell `.qmd` before building out the merge/resolve polish.

## Out of scope (designed-for, not built now)
Hover, diagnostics, definition, signature help. Each is a thin provider reusing
`QuartoCellModelSync` + `quartoPositionMapping`. Diagnostics differ slightly (push, not pull):
the servers already publish diagnostics against the cell model URIs; a later step subscribes to
`IMarkerService` for cell uris and re-projects markers onto the `.qmd` uri with translated ranges.

## Files

New:
- `common/quartoPositionMapping.ts` + `test/common/quartoPositionMapping.vitest.ts`
- `browser/quartoCellModelSync.ts`
- `browser/quartoCellModelService.ts`
- `browser/quartoCompletionProvider.ts` + `test/browser/quartoCompletionProvider.vitest.ts`
- `browser/quartoLanguageFeatures.contribution.ts`

Modified:
- `browser/positronQuarto.contribution.ts` (import the new contribution)
- `common/positronQuartoConfig.ts` (add the `quarto-cell` scheme constant)
- Possibly `extensions/positron-python/**` and `extensions/positron-r/**` documentSelectors
  (only if scheme-restricted -- see risk section).

## Verification

1. **Unit (Vitest, no daemons):**
   - `npx vitest run src/vs/workbench/contrib/positronQuarto/test/common/quartoPositionMapping.vitest.ts`
     -- exhaustive line/range round-trips, fence-line exclusion.
   - `npx vitest run src/vs/workbench/contrib/positronQuarto/test/browser/quartoCompletionProvider.vitest.ts`
     -- build with `createTestContainer().withWorkbenchServices()`, stub the completion registry
     to return a fake provider, assert: prose position -> `undefined`; cell position -> forwarded
     with translated `cellPosition` and results translated back to qmd space; merge of two providers.
   - `npm run test:positron:check-ts` for vitest type errors.
2. **Type-check the source:** rely on build daemons -- `npm run build-ps`, `npm run build-start`
   if needed, then `npm run build-check`.
3. **Manual / E2E (the real proof):** launch Positron, open a `.qmd` with a Python cell and an R
   cell plus prose. Confirm: completions inside the Python cell return Python symbols, inside the
   R cell return R symbols, and in prose the Quarto extension's completions still appear (ours
   returns `undefined`). Confirm editing a cell does not churn (cell model identity stays per
   index). An E2E in `test/e2e/tests/` can automate this once the manual pass is green.
