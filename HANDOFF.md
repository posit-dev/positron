# Quarto shadow notebook: branch orientation

Branch `feature/quarto-shadow-notebook`, based on `origin/main` (10e9b8fa04f,
2026-07-31). Built in three phases (core, language feature bridge, diagnostics
re-projection); this document consolidates all three handoffs. See
`PR-DESCRIPTION.md` for the user-facing summary and the real-server
compatibility table with citations. Prior context lives in the main checkout
(`/Users/seem/posit/positron`): `quarto-lsp-spike/SYNTHESIS.md`,
`quarto-lsp-spike/fake-notebook.md`, and
`quarto-lsp-spike/language-server-matrix.md` (pinned sources for
ruff/pyrefly/ark/air behavior).

## What exists

For every open on-disk Quarto/R Markdown text model, Positron core creates and
owns a hidden notebook document (`notebookType: 'quarto-shadow'`) that shares
the .qmd file's URI and mirrors the document's code cells. The extension host
sees a normal `vscode.NotebookDocument` with standard `vscode-notebook-cell`
URIs, so language clients that declare `notebookDocumentSync` (ruff, pyrefly)
receive `notebookDocument/didOpen`/`didChange`/`didClose` with ordered
cross-cell documents, and clients without it (ark, air, positron LSPs) receive
the cells as plain text documents. Bridge providers surface the servers'
language features inside the .qmd text editor, and cell diagnostics are
re-projected onto the .qmd (with the raw cell markers hidden from the Problems
pane). Gated on the experimental `quarto.shadowNotebook.enabled` (default
`true` on this branch), read live.

## Key file map

Core (`src/vs/workbench/contrib/positronQuarto/` unless noted; all new unless
"modified"):

- `common/quartoShadowNotebook.ts` - `QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE`,
  `fenceLanguageToCellLanguage`, pure reconcile algorithm
  (`computeShadowSyncActions`, `computeMinimalTextEdit`).
- `browser/quartoShadowNotebookSync.ts` - per-document driver: listens to
  `QuartoDocumentModel.onDidParse`, applies splices via
  `NotebookTextModel.applyEdits` (no undo) and in-place edits via lazily
  materialized cell `ITextModel`s (shared text buffer, `CellContentProvider`
  style). Exposes `getOrCreateCellTextModel` (callers must never edit the
  returned model; sync is one-way).
- `browser/quartoShadowNotebookService.ts` - `IQuartoShadowNotebookService`:
  registers the notebook type (core-side, extension-less, no filename
  patterns, priority `option`) and serializer (`notebookToData`/`save` throw -
  the shadow's resource IS the .qmd), watches `IModelService`, owns one
  `ShadowNotebookEntry` per eligible model, re-creates on external disposal
  (capped), reacts live to the setting. API: `getShadowNotebook(uri)`,
  `getCellTextModel(uri, handle)`, `onDidAddShadowNotebook` (fires on create
  AND re-create).
- `common/quartoPositionMapping.ts` - pure line/position/range mapping keyed
  off `QuartoCodeCell.codeStartLine` (cells are verbatim slices; columns 1:1;
  relies on the parser only recognizing column-0 fences - pinned by a test).
- `common/quartoShadowUriLeakGuard.ts` - `isShadowCellUri` (pure:
  `vscode-notebook-cell` scheme + .qmd/.rmd path) and the deep-scan
  fail-closed leak guard used by every bridge provider and the diagnostics
  projector (`command` keys skipped: command payloads round-trip to the
  producing extension where cell URIs are the native coordinates).
- `browser/quartoShadowLanguageBridge.ts` - request resolution
  (`resolveRequest`: .qmd position -> cell + materialized cell model; prose
  and fence lines resolve undefined), location back-mapping
  (`mapLocationToDocument`: cross-document, drop-on-unmappable), `invokeSafely`.
- `browser/quartoShadowCompletionProvider.ts`,
  `browser/quartoShadowCodeActionProvider.ts`,
  `browser/quartoShadowLanguageFeatureProviders.ts` (hover, signature help,
  definition, references, document highlights),
  `browser/quartoShadowLanguageFeatures.contribution.ts` - the bridge
  providers, registered once for `QUARTO_LANGUAGE_IDS`.
- `browser/quartoShadowDiagnostics.ts` - `QuartoShadowNotebookDiagnostics`
  (per-notebook projector) + `QuartoShadowDiagnosticsContribution` (attaches
  one per shadow notebook via `onDidAddShadowNotebook`, disposes on the
  notebook's `onWillDispose`).
- `common/positronQuartoConfig.ts` (modified) -
  `QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY`,
  `QUARTO_SHADOW_DIAGNOSTICS_OWNER_PREFIX`.
- `browser/positronQuarto.contribution.ts` (modified) - service singleton +
  the three workbench contributions.

Marker service (platform):

- `src/vs/platform/markers/common/positronMarkerService.ts` -
  `PositronMarkerService extends MarkerService`: per-resource, refcounted
  read exclusions (`installResourceExclusion`). Registered instead of
  `MarkerService` in `workbench.common.main.ts` (wrapped Positron change).
- `src/vs/platform/markers/common/markers.ts` (modified, wrapped) - optional
  `installResourceExclusion?` on `IMarkerService` (present when the workbench
  registers the Positron service; callers use `?.`).
- `src/vs/platform/markers/common/markerService.ts` (modified, wrapped) -
  `_onMarkerChanged` widened `private` -> `protected` so the subclass can fire
  on exclusion install/release.

Other modified files:

- `src/vs/workbench/contrib/runtimeNotebookKernel/browser/runtimeNotebookKernelService.ts`
  (Positron-owned) - kernel exclusion for the shadow viewType in
  `attachNotebook` and the `onWillRemoveNotebookDocument` shutdown handler
  (critical: Quarto inline output kernels are notebook sessions keyed by the
  same .qmd URI - without the guard, closing a shadow kills the user's
  kernel).
- `extensions/positron-r/src/lsp.ts`, `extensions/positron-python/src/client/positron/lsp.ts` -
  console-client selector entries for shadow cells
  (`{ language, scheme: 'vscode-notebook-cell', pattern: '**/*.{qmd,rmd,Rmd}' }`).
- `.vscode-test.js`, `build/npm/dirs.ts`, `build/gulpfile.extensions.ts` -
  registration of the test-only extension.
- `extensions/quarto-shadow-notebook/` - test-only extension (contributes only
  test-harness language ids, never shipped) hosting the ext host suite: real
  LanguageClient 10.0.0 + 9.0.1 (npm alias `vscode-languageclient-9`) against
  in-process `vscode-languageserver` connections.

## Design decisions and invariants

### Creation path (the Phase 1 tracer bullet)

The shadow is created with `INotebookService.createNotebookTextModel(...)`,
NOT the editor model resolver. `MainThreadNotebooksAndEditors` mirrors
anything registered with `INotebookService`, and this path creates **no
working copy**: no dirty state, no backups, no Save All, no restore-on-reload,
no reference-expiry disposal. NEVER resolve the .qmd through
`INotebookEditorModelResolverService` or `vscode.workspace.openNotebookDocument`
- that wraps the shadow in a working copy and disposes it when the reference
lapses (the service defends by re-creating, capped at 3).

### Sync algorithm

Anchor identical cells at both ends; equal-length, language-matching middle
windows become minimal in-place text edits (stable handles/URIs -> incremental
didChange, servers keep per-cell state); anything else becomes one splice.
Never keyed by content hash across parses. Same-language reorders surface as
content edits; edit+structure in one debounce window collapses into one
splice. Cell language = `kernelToLanguageId(fence) ?? fence.toLowerCase()`,
shared by serializer and sync.

### Cell correlation

Parse cell `i` <-> notebook cell `i` is a same-instant correspondence used at
request/projection time, guarded by a language equality check for the window
where a structural reparse races the sync. Nothing is persisted by index
across parses; persistent identity is cell handle/URI only.

### Cell text models

Get them via `IQuartoShadowNotebookService.getCellTextModel(resource, handle)`
and never edit them. Do NOT use `ITextModelService.createModelReference` on an
unmaterialized cell URI: `CellContentProvider` would resolve the notebook
through the editor model resolver (the forbidden path).

### Bridge behavior

Requests in prose or on fence lines return undefined (the Quarto extension
owns prose). The setting is read live per request (no provider churn on
toggle). Trigger characters are a static superset (`. $ : @` completions,
`( ,` signature help) because a .qmd hosts several languages in one model.
Known ~100ms staleness window: requests racing a keystroke see the previous
parse (debounced); add a `flush()` to `QuartoDocumentModel` if it ever
matters. Merge semantics per feature are documented in the provider files
(completions: all providers merged; hover: contents concatenated; signature
help: first in score order; definition/references: flattened with location
mapping; code actions: workspace edits rewritten onto the .qmd; highlights:
request cell only).

### Leak guard invariant

No shadow-cell URI may surface in a user-facing result. Translation first
(`mapLocationToDocument`), deep-scan guard as fail-closed backstop in every
provider and on every projected marker.

### Diagnostics re-projection (Phase 3)

`QuartoShadowNotebookDiagnostics`, one per shadow notebook:

- **Triggers**: `IMarkerService.onMarkerChanged` touching a cell resource,
  `QuartoDocumentModel.onDidParse` (line offsets shift without marker
  changes), `NotebookTextModel.onDidChangeContent` (splices). The reaction is
  ALWAYS deferred through a `RunOnceScheduler(0)`. Never call
  `markerService.changeOne` inside an `onMarkerChanged` handler: the marker
  service's `MicrotaskEmitter` coalesces the re-entrant fire into the
  in-flight batch and other listeners never observe it (Davis Vaughan's spike
  hit this; see the class JSDoc).
- **Projection**: for each cell (same-instant index correspondence + language
  check), read markers with `ignoreResourceFilters: true`, translate with
  `toDocumentRange`, write with
  `changeOne('quartoShadowDiagnostics/<sourceOwner>', qmdUri, markers)`.
  Owner-per-source-owner means multiple servers never clobber each other, and
  owners that go quiet are cleared. Severity/message/source/code/tags
  preserved; relatedInformation mapped through
  `bridge.mapLocationToDocument` (cell entries -> owning .qmd, real files pass
  through, unmappable dropped); `origin` deliberately NOT carried over (so
  `MainThreadDiagnostics` forwards the projected marker to the ext host
  mirror and `vscode.languages.getDiagnostics(qmdUri)` sees it);
  `modelVersionId` dropped (cell model version is meaningless on the .qmd).
- **Stale ranges**: a marker starting beyond the cell's current code is
  dropped (stale publish; the next publish re-projects); a marker overrunning
  the cell end is clamped to the last code line so the squiggle never bleeds
  into prose.
- **No-churn writes**: re-projections producing identical markers skip the
  write (`onDidParse` fires on every debounced keystroke; a redundant
  `changeOne` would churn the Problems pane). Writes target only the .qmd
  resource, which the projector does not listen to, so it can never
  re-trigger itself.
- **Suppression seam**: `PositronMarkerService.installResourceExclusion(cellUri)`
  hides a resource from regular `IMarkerService.read` calls (Problems pane,
  `getStatistics`, marker navigation) while `ignoreResourceFilters` readers
  still get the data. The decisive property: `MainThreadDiagnostics` reads
  with `ignoreResourceFilters: true` and only mirrors into the ext host's
  mirror collection - extension-owned `DiagnosticCollection`s (what code
  action providers read via `vscode.languages.getDiagnostics(cellUri)`) are
  never touched. This was chosen over (a) deleting cell markers after copying
  (loses the source of truth for later reparses, can't distinguish "we
  deleted" from "server cleared", flickers) and (b) filtering in the Problems
  pane only (misses status-bar counts and cross-file marker navigation).
  Exclusions are installed synchronously when cells appear (before a server
  can possibly publish) and, for spliced-away cells, retained until the
  server clears the stale markers so they never flash back.
- **Lifecycle**: document close / setting off / external disposal all dispose
  the notebook -> `onWillDispose` -> projector disposes -> projected markers
  cleared, exclusions released.

### Hide-everywhere audit (from Phase 1, still holds)

No editor/tab/quick-open/outline surface exists for the shadow (no editor
input is ever created; the contributed type has no selectors). No working
copy UI. Kernel machinery excluded. The Problems pane surface is now owned by
the Phase 3 suppression. Ext-host restart re-mirrors from core state; window
reload re-creates from open models (by construction, not by test).

## Real-server compatibility

See PR-DESCRIPTION.md for the full verdict table with citations. Summary:
ruff and pyrefly declare cells-only notebook selectors (no notebookType
constraint) and work as-is - proven by an ext host suite that registers
ruff's capability shape verbatim on languageclient 9.0.1. ark and air receive
cells as plain text documents; the console-client selector entries added on
this branch close the positron-r / positron-python gap. air's selector
already includes the cell scheme.

**Open coexistence question**: when a Quarto inline-output session runs, the
per-notebook LSP client (`pattern: notebookUri.fsPath`) ALSO matches the
document's shadow cells, so cells can sync to both the console and notebook
clients (duplicate completions via the bridge's merge; potentially duplicate
diagnostics under distinct collection names). Follow-up: single-ownership
gating mirroring the existing vdoc middleware in both extensions. Similarly,
the Quarto extension's vdoc-based completions still run alongside the bridge.

## Tests and how to run them

Vitest - 111 branch tests, 323 total across the two directories (no build
needed):

```bash
npx vitest run src/vs/workbench/contrib/positronQuarto/ src/vs/platform/markers/
npm run test:positron:check-ts   # no quartoShadow*/positronMarker* errors
```

- `test/common/quartoShadowNotebook.vitest.ts` (23) - reconcile algorithm.
- `test/browser/quartoShadowNotebookSync.vitest.ts` (14) - real
  `NotebookTextModel` sync, handle stability.
- `test/browser/quartoShadowNotebookService.vitest.ts` (9) - lifecycle,
  setting, external-dispose recreate.
- `test/common/quartoPositionMapping.vitest.ts` (9),
  `test/common/quartoShadowUriLeakGuard.vitest.ts` (9).
- `test/browser/quartoShadowLanguageFeatures.vitest.ts` (16),
  `quartoShadowCompletionProvider.vitest.ts` (9),
  `quartoShadowCodeActionProvider.vitest.ts` (6) - bridge providers.
- `test/browser/quartoShadowDiagnostics.vitest.ts` (10) - projection
  correctness and metadata, relatedInformation mapping, suppression,
  per-owner keying, other-owner passthrough, drop/clamp of stale ranges,
  reparse line shifts, event-storm convergence (steady state fires zero .qmd
  marker events), splice cleanup + deferred exclusion release, contribution
  attach/dispose (covers document close and setting-off teardown).
- `src/vs/platform/markers/test/common/positronMarkerService.vitest.ts` (6) -
  exclusion semantics (read shapes, refcounting, events, statistics, no
  placeholder marker, ignoreResourceFilters bypass).

Extension host - 13 tests (needs compiled `out/` + the test extension
compiled):

```bash
npm run build-start && npm run build-check
cd extensions/quarto-shadow-notebook && npx tsc -p ./tsconfig.json && cd ../..
API_TESTS_EXTRA_ARGS="--disable-telemetry --disable-experiments --skip-welcome \
  --skip-release-notes --no-cached-data --disable-updates --use-inmemory-secretstorage \
  --disable-extensions --disable-workspace-trust --user-data-dir=/tmp/qsn-udd" \
  npm run test-extension -- -l quarto-shadow-notebook
```

Harness notes: this worktree needed `ln -s <main-checkout>/.build/electron
.build/electron` and a copy of `<main-checkout>/out/esm-package-dependencies`
into `out/` (both done); the short `--user-data-dir` avoids unix-socket
path-length overflow; NEVER `client.stop()` an in-process
`vscode-languageserver` connection (its exit handler calls `process.exit()`
on the ext host). The test extension's `package.json` contributes the
`quarto` language and a bare `python` id because the harness runs with
built-in extensions disabled. The same registered-language requirement
applies to vitest stubs (`ctx.get(ILanguageService).registerLanguage(...)`).

Build state: `npm run build-check` reports only the pre-existing
`positronAiProvider`/`positronHeadlessLanguageModel` errors (6, ai-config
drift) and the `watch-e2e` missing-optional-dep errors (4); zero errors in
branch files. `valid-layers-check`'s `layersChecker.ts` passes; the
subsequent `tsgo --project build/checker/*` steps emit repo-wide pre-existing
TS6142 `--jsx` noise, none referencing branch files. Commits are unsigned
(`-c commit.gpgsign=false`; the 1Password SSH signer was unavailable);
re-sign if needed. This worktree symlinks `extensions/positron-r/node_modules`
and `extensions/positron-python/node_modules` from the main checkout
(excluded via `.git/info/exclude`).

## Known gaps / follow-ups

- Quarto extension coexistence (vdoc completions run alongside the bridge).
- Console vs notebook LSP ownership of shadow cells during Quarto
  inline-output sessions (see compatibility section).
- Untitled .qmd documents get no shadow (by design for now).
- Same-language cell reorders surface as content edits, not moves.
- Document highlights cover the request cell only.
- Ext-host-restart behavior is by construction, not by test; no Playwright
  e2e coverage yet.
- Brief window on document close where servers haven't cleared cell markers
  yet after the exclusions are released (invisible in practice: the didClose
  clear follows immediately).
