# Phase 1 handoff: Quarto shadow notebook core

Branch `feature/quarto-shadow-notebook`, based on `origin/main` (10e9b8fa04f, 2026-07-31).
Prior context: `quarto-lsp-spike/SYNTHESIS.md` and `quarto-lsp-spike/fake-notebook.md`
in the main checkout (`/Users/seem/posit/positron`).

## What exists

For every open on-disk Quarto/R Markdown text model, Positron core creates and owns a
hidden notebook document (`notebookType: 'quarto-shadow'`) that shares the .qmd file's
URI and mirrors the document's code cells. The extension host sees it as a normal
`vscode.NotebookDocument` with standard `vscode-notebook-cell` URIs, so language
clients that declare `notebookDocumentSync` (ruff, pyrefly, positron-python) receive
`notebookDocument/didOpen`/`didChange`/`didClose` with ordered cross-cell documents -
with zero changes in language extensions. Gated on the experimental setting
`quarto.shadowNotebook.enabled` (default `true` on this branch), read live.

## Tracer-bullet verdict (the Phase 1 question)

**The mirroring creation path is `INotebookService.createNotebookTextModel(viewType, uri, stream)`,
NOT the editor model resolver.** Proven end-to-end by the extension host test
(`extensions/quarto-shadow-notebook/src/test/shadowNotebook.test.ts`): opening a .qmd
text document (no editor anywhere) produces an ext-host `NotebookDocument` with correct
cell URIs, texts, and language IDs, and a real bundled `vscode-languageclient` (10.0.0
and 9.0.1) syncs it to a real `vscode-languageserver` connection.

Why this works: `MainThreadNotebooksAndEditors` builds its ext-host delta from
`INotebookService.listNotebookDocuments()` (fired by `onWillAddNotebookDocument`), so
any model registered with the notebook service is mirrored - resolver involvement is
irrelevant to mirroring. (A bare `new NotebookTextModel(...)` would NOT be mirrored;
the service registration is the mirror trigger.)

Deliberate deviation from the plan's expectations, with evidence:

- **No never-dirty core change was needed.** The spike (resolver path) hit dirty
  working copies because `INotebookEditorModelResolverService.resolve` creates a
  `SimpleNotebookEditorModel` + stored file working copy. `createNotebookTextModel`
  creates **no working copy at all**: there is no dirty state, no backup writes, no
  Save All participation, no restore-on-reload, and no 3-minute
  `BoundModelReferenceCollection` expiry (core owns the model outright). The ext host
  test asserts `notebook.isDirty === false` after mirrored edits. This also avoids the
  resolver path's reload-from-disk hazard (`NotebookFileWorkingCopyModel.update` calls
  `notebookModel.reset` = full cell shear on every save/external change).
- **Residual working-copy exposure**: if some other party resolves the .qmd URI as a
  notebook editor model (e.g. an extension calls
  `vscode.workspace.openNotebookDocument(qmdUri)`), the resolver wraps *our* model in a
  working copy and **disposes our model** when its last reference drops (3 minutes for
  API-held refs). `ShadowNotebookEntry` defends by re-creating the shadow on external
  disposal (capped at 3 re-creations; covered by a vitest). No bundled extension does
  this today. If it ever becomes real, the fix is the originally-planned upstream
  change (never-dirty stored working copies for the shadow viewType).

## Key file map

Core (all new unless noted):

- `src/vs/workbench/contrib/positronQuarto/common/quartoShadowNotebook.ts` -
  `QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE`, `fenceLanguageToCellLanguage`, and the pure
  reconcile algorithm (`computeShadowSyncActions`, `computeMinimalTextEdit`).
- `src/vs/workbench/contrib/positronQuarto/browser/quartoShadowNotebookSync.ts` -
  `QuartoShadowNotebookSync`: per-document driver. Listens to
  `QuartoDocumentModel.onDidParse`, applies splices via `NotebookTextModel.applyEdits`
  (`CellEditType.Replace`, no undo) and in-place edits via lazily materialized cell
  `ITextModel`s (shared text buffer, `CellContentProvider` style - required because
  cell text only reaches the ext host through the `IModelService` document sync
  channel).
- `src/vs/workbench/contrib/positronQuarto/browser/quartoShadowNotebookService.ts` -
  `IQuartoShadowNotebookService` + implementation: registers the notebook type
  (core-side, extension-less, no filename patterns, priority `option`) and serializer
  (`dataToNotebook` parses via `parseQuarto`; `notebookToData`/`save` throw - the
  shadow must never be written to disk, its resource IS the .qmd), watches
  `IModelService` model add/remove/language-change, owns one `ShadowNotebookEntry`
  per eligible model, reacts live to the setting.
- `src/vs/workbench/contrib/positronQuarto/common/positronQuartoConfig.ts` (modified) -
  `QUARTO_SHADOW_NOTEBOOK_ENABLED_KEY` = `quarto.shadowNotebook.enabled`.
- `src/vs/workbench/contrib/positronQuarto/browser/positronQuarto.contribution.ts`
  (modified) - singleton + `WorkbenchPhase.AfterRestored` contribution.
- `src/vs/workbench/contrib/runtimeNotebookKernel/browser/runtimeNotebookKernelService.ts`
  (modified, Positron-owned) - kernel exclusion: `attachNotebook` skips the shadow
  viewType (no kernel selection/affinity/log noise), and the
  `onWillRemoveNotebookDocument` shutdown handler skips it (critical: Quarto inline
  output kernels are *notebook sessions keyed by the same .qmd URI* - without the
  guard, closing a shadow would kill the user's Quarto kernel).

Tests:

- `src/vs/workbench/contrib/positronQuarto/test/common/quartoShadowNotebook.vitest.ts` (23 tests)
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoShadowNotebookSync.vitest.ts` (14 tests, real `NotebookTextModel`)
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoShadowNotebookService.vitest.ts` (9 tests, lifecycle/setting/external-dispose)
- `extensions/quarto-shadow-notebook/` - test-only extension (contributes nothing,
  never shipped) hosting the ext-host suite: real LanguageClient (10.0.0 + 9.0.1
  via npm alias `vscode-languageclient-9`) against an in-process
  `vscode-languageserver`; 7 tests. Registered in `.vscode-test.js`,
  `build/npm/dirs.ts`, `build/gulpfile.extensions.ts`.

## Design decisions

- **Sync algorithm** (`computeShadowSyncActions`): anchor identical cells at both ends;
  if the differing middle window has equal length and pairwise-equal languages, emit
  minimal in-place text edits (common prefix/suffix trim), else one splice replacing
  the window. Never keyed by content hash. Consequences:
  - Edit inside one cell -> one minimal `didChange` text edit; cell handles/URIs stable
    (asserted in tests) - fixes the branch's cell-shear class.
  - Add/remove/language-change -> single splice; neighbors untouched (ext host test
    asserts existing cells are not closed by the splice).
  - Same-language reorder is indistinguishable from editing both cells without content
    keying, so it surfaces as in-place edits (documented in code). Different-language
    reorder splices.
  - An edit + structural change landing in the same 100ms debounce window collapses
    into one window splice (rare; converges).
- **Cell language**: `kernelToLanguageId(fence) ?? fence.toLowerCase()` (e.g.
  `python3 -> python`); shared by serializer and sync so the initial parse and first
  reconcile agree byte-for-byte (parser and `getCellCode` both produce LF-joined fence
  bodies).
- **Eligibility**: `file`/`vscode-remote` schemes + `isQuartoDocument(path, languageId)`.
  Untitled documents are excluded for now - the same-URI design's payoffs (server
  config discovery, 10.x pull-diagnostic visibility via the text tab URI) assume a
  real file path. Rename/save-as works via model remove+add (URI-keyed entries).
- **Ext-host restart / window reload**: the core model is independent of the ext host;
  a restarted ext host receives the full notebook state from
  `MainThreadNotebooksAndEditors`'s initial delta (the #11292 failure class does not
  apply - nothing on the ext host owns the shadow). Window reload persists nothing
  (no working copy/backups); the AfterRestored contribution re-creates shadows from
  open models. Not covered by an automated test (restart is not reachable from the
  ext-host harness); behavior is by construction.

## Hide-everywhere audit (requirement 7)

- **Editor choice / "Open With..."**: clean by construction - the contributed type has
  no `extension`, so `NotebookProviderInfoStore.add` registers no editor with the
  editor resolver, and it has no filename patterns so it can never match a resource.
  Priority `option` as belt-and-braces. (Interactive-window precedent; the store
  restores the memento-persisted info on startup, handled like interactive.)
- **Tabs / visible editors**: asserted in the ext host test - zero
  `visibleNotebookEditors`, zero `TabInputNotebook` tabs while the shadow lives.
- **Quick open / recently opened**: driven by editor history; no editor input is ever
  created for the shadow. Clean.
- **Working-copy UI (dirty badges, Save All, backup/hot-exit, restore-on-reload)**:
  clean - no working copy exists (see tracer-bullet section); `isDirty === false`
  asserted after mirrored edits.
- **Outline / breadcrumbs**: driven by the active editor pane; none exists. Clean.
- **Kernel machinery**: excluded in `runtimeNotebookKernelService` (selection +
  shutdown paths, see above). Test runs show no "No kernel for preferred runtime"
  noise for shadows. Note: "Lookup notebook session ... not found" lines still appear
  when a .qmd *text editor* is focused - that is Quarto inline output's own
  editor-driven kernel-state polling, pre-existing and unrelated to shadows.
- **Ext-host `onDidOpenNotebookDocument` consumers**: bundled extensions were grepped;
  only Copilot observes notebooks generically (passive workspace indexing). ipynb,
  positron-python, positron-r do not react to foreign notebook types. The Jupyter
  extension is not bundled in Positron.
- **Problems pane**: server-pushed diagnostics on cell URIs DO appear (that is the
  point) but currently under `vscode-notebook-cell:` URIs ending in `.qmd`. Phase 2's
  re-projection + suppression owns this surface; until then the raw markers are
  visible when a server targets the shadow (today only the toy test server does; no
  bundled server declares a `quarto-shadow` notebook selector yet).

## How to run the tests

```bash
# Vitest (46 tests; no build needed)
npx vitest run src/vs/workbench/contrib/positronQuarto/

# Vitest type-check
npm run test:positron:check-ts       # no quartoShadow* errors (other failures pre-date this branch)

# Extension host (7 tests; needs compiled out/ + the test extension compiled)
npm run build-start && npm run build-check
cd extensions/quarto-shadow-notebook && npm ci --ignore-scripts && npx tsc -p ./tsconfig.json && cd ../..
API_TESTS_EXTRA_ARGS="--disable-telemetry --disable-experiments --skip-welcome \
  --skip-release-notes --no-cached-data --disable-updates --use-inmemory-secretstorage \
  --disable-extensions --disable-workspace-trust --user-data-dir=/tmp/qsn-udd" \
  npm run test-extension -- -l quarto-shadow-notebook
```

Harness notes (ported from the spike): this worktree needed
`ln -s <main-checkout>/.build/electron .build/electron` and a copy of
`<main-checkout>/out/esm-package-dependencies` into `out/` (both already done here);
the short `--user-data-dir` avoids unix-socket path-length overflow; never
`client.stop()` an in-process `vscode-languageserver` connection (its exit handler
calls `process.exit()` on the ext host).

Build state: `npm run build-check` reports 6 pre-existing errors in
`positronAiProvider`/`positronHeadlessLanguageModel` (ai-config module drift,
untouched by this branch) and 4 pre-existing `watch-e2e` missing-optional-dep errors;
zero errors in files added/modified here. Commits on this branch are unsigned
(`-c commit.gpgsign=false`) because the 1Password SSH signer was unavailable in the
session; re-sign if needed.

## API for Phase 2 (bridge providers + diagnostics re-projection)

Consume `IQuartoShadowNotebookService` (`browser/quartoShadowNotebookService.ts`):

- `getShadowNotebook(qmdUri): NotebookTextModel | undefined` - the live mirror.
  Its `cells` are `NotebookCellTextModel`s: `cell.uri` is the `vscode-notebook-cell`
  URI diagnostics arrive on, `cell.handle` is stable across edits (splices mint new
  handles; in-place edits never do). Map cell -> qmd coordinates through
  `IQuartoDocumentModelService.getModel(...)`'s `QuartoCodeCell.codeStartLine`
  (cells are verbatim slices: qmdLine = cellLine + codeStartLine - 1, columns
  unchanged). Map by URI/handle, never by index.
- `onDidAddShadowNotebook` - fires on create AND on re-create after external disposal;
  re-hook any per-notebook listeners there and drop them on the notebook's
  `onWillDispose`.
- For provider bridging, materialized cell `ITextModel`s may already exist (the sync
  creates them lazily for edited cells); `ITextModelService.createModelReference(cellUri)`
  is safe for the rest - `CellContentProvider` short-circuits to the existing
  `IModelService` model, or materializes one against the live notebook.

Things Phase 2 must NOT do:

- Do not resolve the .qmd through `INotebookEditorModelResolverService` (or
  `vscode.workspace.openNotebookDocument`) - that wraps the shadow in a working copy,
  reintroduces dirty/backup hazards, and disposes the model when the reference lapses
  (triggering the recreate path and a didClose/didOpen churn at the servers).
- Do not edit shadow cells or cell text models directly - sync is strictly one-way
  (.qmd -> notebook). Workspace edits from servers must be translated to .qmd edits.
- Do not key anything by cell index across parses; use handle or URI.
- Do not assume one didChange per user edit: a single reparse can emit several
  in-place edits, and a structural+content change arrives as one splice.

## Known gaps

- Untitled .qmd documents get no shadow (excluded by design for now).
- Raw cell-URI markers show in the Problems pane until Phase 2 re-projection lands.
- No bundled language server declares a `quarto-shadow` notebook selector yet;
  enabling ruff/pyrefly/positron-python for the shadow type (server capability
  question) is Phase 2/3 territory, as is the Quarto extension coexistence flag.
- Ext-host-restart behavior is by construction, not by test.
- Same-language cell reorders surface as content edits, not moves (see design notes).
