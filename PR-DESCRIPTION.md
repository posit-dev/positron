# Quarto shadow notebooks: real language intelligence in .qmd editors

## Problem

Language intelligence inside Quarto and R Markdown code cells is far weaker
than in scripts or notebooks. The Quarto extension's virtual-document
mechanism forwards completions and hovers per cell, but every cell is an
isolated document: no cross-cell analysis (a variable defined two chunks up is
"undefined"), no diagnostics at all (there is no `executeDiagnosticProvider`,
and both positron-python and positron-r carry middleware to *suppress* the
vdoc diagnostics that leak through), and modern notebook-aware servers (ruff,
pyrefly) never see the document as the notebook it conceptually is.

Meanwhile those servers already solve this exact problem for `.ipynb`: they
declare LSP `notebookDocumentSync`, receive ordered cross-cell documents, and
push per-cell diagnostics. This PR gives them a notebook for `.qmd` files.

## Architecture

For every open on-disk Quarto/R Markdown text model, Positron core creates a
hidden notebook document (`notebookType: 'quarto-shadow'`) that shares the
.qmd file's URI and mirrors its code cells. It has no editor, no tab, no
working copy, no kernel; the extension host sees a normal
`vscode.NotebookDocument`, so language clients that declare
`notebookDocumentSync` sync it with zero changes.

```
 .qmd text model ──parse──> QuartoDocumentModel ──sync──> shadow NotebookTextModel
      ^                          (debounced)                (hidden, same URI)
      │                                                          │ mirrored
      │  bridge providers translate                              v
      │  requests/results between                        ext host NotebookDocument
      │  .qmd and cell coordinates                               │ notebookDocumentSync /
      │                                                          │ plain text sync
      └── squiggles, Problems pane <──re-projection──── language servers
          (diagnostics mapped back                      (ruff, pyrefly, ark, air, ...)
           onto the .qmd)
```

Three subsystems, in `src/vs/workbench/contrib/positronQuarto/`:

1. **Shadow notebook core** (`quartoShadowNotebookService.ts`,
   `quartoShadowNotebookSync.ts`): creates the notebook through
   `INotebookService.createNotebookTextModel` (mirrored to the ext host, but
   never wrapped in a working copy - it can never be dirty, saved, backed up,
   or restored). Reconciles on every reparse: in-cell edits become minimal
   incremental cell edits (stable cell URIs/handles, so servers keep per-cell
   state), structural changes become single splices. Kernel machinery
   explicitly skips the shadow type.
2. **Language feature bridge** (`quartoShadowLanguageBridge.ts` + providers):
   core-side providers registered for the `quarto`/`rmd` language ids resolve
   the cell under a request, forward to the real providers registered for the
   cell's text model, and translate results back. Completions, hover,
   signature help, definition, references, code actions (with workspace edits
   rewritten onto the .qmd), and document highlights. A deep-scan leak guard
   ensures no `vscode-notebook-cell:` URI ever surfaces to the user.
3. **Diagnostics re-projection** (`quartoShadowDiagnostics.ts`): servers push
   per-cell diagnostics against cell URIs; a per-document projector copies
   them onto the .qmd resource with translated ranges (metadata, severity,
   code, tags, and relatedInformation preserved; related info pointing at
   cells is mapped too), keyed per source owner so multiple servers coexist.
   The raw cell markers are hidden from the Problems pane via a new
   `PositronMarkerService` (a `MarkerService` subclass registered by the
   workbench) that supports per-resource read exclusions - presentation-only:
   `ignoreResourceFilters` readers, including the ext host bridge that backs
   `vscode.languages.getDiagnostics` and code action contexts, still see the
   raw data.

Everything is gated on a single experimental setting,
`quarto.shadowNotebook.enabled` (default on), read live.

## What works

| Feature | Status | Notes |
|---|---|---|
| Hidden notebook sync | Works | didOpen/didChange/didClose with ordered cross-cell documents; incremental cell edits; never dirty |
| Completions | Works | merged across providers; resolve round-trips; ranges and additionalTextEdits translated |
| Hover | Works | providers merged into one hover |
| Signature help | Works | first result in score order |
| Definition / References | Works | locations in cells map to the owning .qmd (including other open .qmd files); real files pass through |
| Code actions | Works | workspace edits on cells rewritten onto the .qmd; resolve supported |
| Document highlights | Works | request cell scope |
| Diagnostics | Works | per-cell push diagnostics re-projected onto the .qmd; raw cell entries suppressed from the Problems pane; other .qmd diagnostics (Quarto prose) untouched |
| Prose / fence lines | Untouched | requests outside cell code return nothing; the Quarto extension keeps owning prose |

## Real-server compatibility (verified against pinned sources)

| Server | Verdict | Evidence |
|---|---|---|
| **ruff** (bundled charliermarsh.ruff 2026.68.0) | Works as-is | Server declares `notebookDocumentSync` with a cells-only selector - `{ notebookSelector: [{ cells: [{ language: 'python' }] }], save: false }`, **no notebookType constraint** (`crates/ruff_server/src/server.rs` @ 31cb63ae, L237-251) - and pushes per-cell `publishDiagnostics` unconditionally on notebook open/change (`did_open_notebook.rs` L39-45, `did_change_notebook.rs` L23-32). Client selector includes `{ scheme: 'vscode-notebook-cell', language: 'python' }` (`src/common/utilities.ts` L38-48, verified at the bundled 2026.68.0 tag). An extension host test in this PR registers ruff's capability shape verbatim on the languageclient major ruff bundles (9.0.1) and proves the shadow notebook syncs and pushes per-cell diagnostics. |
| **pyrefly** (bundled meta.pyrefly 1.1.1) | Works as-is | Server declares the same cells-only selector (`notebook: None`), gated on init option `pyrefly.syncNotebooks`, default `true` (verified at the 1.1.1 tag, `pyrefly/lib/lsp/non_wasm/server.rs` L1355-1367). Client selector includes the cell scheme; the `notebookDocumentSync` blob it passes under `@ts-ignore` is not a languageclient option and is dead config - the effective selector is the server's any-notebook-type one. Positron has no client config for pyrefly to change (it is a bootstrapped extension). |
| **ark / positron-r** | Fixed in this PR | ark has no `notebookDocumentSync`, so cells sync as plain text documents - but the console client's selectors did not match the cell scheme. Added `{ language: 'r', scheme: 'vscode-notebook-cell', pattern: '**/*.{qmd,rmd,Rmd}' }` to the console client (`extensions/positron-r/src/lsp.ts`). Notebook-session clients (Quarto inline output) already matched via `pattern: notebookUri.fsPath`. ark's push diagnostics for R cells now re-project onto the .qmd. |
| **positron-python's own LSP** | Fixed in this PR | Same shape: the pygls server's notebook sync only covers `jupyter-notebook`, and the console client didn't match cell URIs. Added the symmetric selector entry (`extensions/positron-python/src/client/positron/lsp.ts`) so python shadow cells sync as plain text documents and get runtime-aware completions. |
| **air** (bundled posit.air-vscode 0.28.0) | Works as-is | Formatting-only. Selector already includes `{ language: 'r', scheme: 'vscode-notebook-cell' }` (`editors/code/src/lsp.ts` L196-202, verified at 0.28.0 = current main); its cell handling keys on the `vscode-notebook-cell` scheme, which shadow cells use. |

Known coexistence note: when a Quarto inline-output R/Python session is
running, that notebook-session client also matches the document's shadow
cells (its selector is `pattern: <qmd path>`), so cells can sync to both the
console and the notebook client. Deciding single ownership (mirroring the
existing vdoc gating) is listed as a follow-up.

## Out of scope (follow-ups)

- Quarto extension coexistence: deduplicating against the vdoc-based
  completions/hover when the shadow bridge is active (today both answer;
  ranking usually hides the difference).
- Console vs notebook LSP ownership of shadow cells when a Quarto
  inline-output session is running (see note above).
- Visual editor support (the shadow tracks the source document only).
- Untitled .qmd documents (excluded by design: same-URI benefits assume a
  real file path).
- Playwright e2e coverage; behavior is covered by unit and extension host
  suites below.
- Multi-cell document highlights (needs the multiDocumentHighlightProvider
  registry).

## Tests

- **Vitest** (`npx vitest run src/vs/workbench/contrib/positronQuarto/ src/vs/platform/markers/`):
  111 tests added by this branch (sync algorithm and service lifecycle: 46;
  position mapping, leak guard, and bridge providers: 49; diagnostics
  re-projection and marker exclusions: 16). 323 pass across the two
  directories.
- **Extension host** (`npm run test-extension -- -l quarto-shadow-notebook`):
  13 tests against a real vscode-languageclient (10.0.0 and 9.0.1) and a real
  in-process vscode-languageserver: hidden-notebook mirroring, incremental
  didChange, splice behavior, push diagnostics, setting toggle, bridged
  completions/hover at cell coordinates, diagnostics re-projection onto the
  .qmd (with the cell keeping its extension-side diagnostics), and the
  ruff-shaped registration suite.
- `npm run build-check`, `npm run test:positron:check-ts`, and
  `npm run valid-layers-check` are clean relative to the pre-existing
  baseline (unrelated positronAiProvider/ai-config drift).
