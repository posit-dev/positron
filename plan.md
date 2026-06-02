# Quarto Source Mode → Notebook View

**Goal.** When a user edits a `.qmd` file as plain text, give the language services
(R LSP, Python LSP, …) the same experience they get inside a notebook: hover on an
R symbol calls the R server, hover on a Python symbol calls the Python server,
diagnostics light up the right cell, rename/format work across cells.

**Strategy.** Each open `.qmd` owns a **shadow `NotebookTextModel`** kept in sync
with the flat text. The visible editor still edits the `TextModel`. LSP requests
are intercepted at the language-feature layer and re-dispatched to the **cell
URI** of the cell under the cursor. Existing notebook LSP plumbing does the rest.

> **Key insight.** `CellContentProvider`
> ([`notebook.contribution.ts:389-439`](src/vs/workbench/contrib/notebook/browser/notebook.contribution.ts))
> already materializes cell `ITextModel`s on demand from a cell's `textBuffer`.
> We reuse that machinery — we just need to be the thing producing the cells.

---

## Table of contents

1. [Mental model](#1-mental-model)
2. [Core components](#2-core-components)
3. [Data flow walkthroughs](#3-data-flow-walkthroughs)
4. [Extension-host visibility](#4-extension-host-visibility)
5. [File layout](#5-file-layout)
6. [Hard edge cases](#6-hard-edge-cases)
7. [Incremental build order](#7-incremental-build-order)
8. [Tradeoffs and open questions](#8-tradeoffs-and-open-questions)

---

## 1. Mental model

```
        ┌─────────────────────────────────────────────────┐
        │  Visible editor                                 │
        │  ─────────────                                  │
        │  .qmd TextModel  (source of truth, on disk)     │
        └────────────────────────┬────────────────────────┘
                                 │ onDidChangeContent
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  QmdNotebookSync                                │
        │    incremental parse + diff + buffer mutations  │
        └────────────────────────┬────────────────────────┘
                                 │ applyEdits / splice
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  Shadow NotebookTextModel  (headless, in-memory)│
        │    cell[0] markdown    "# Intro"                │
        │    cell[1] r           "x <- 1"                 │
        │    cell[2] markdown    "Some prose"             │
        │    cell[3] python      "import pandas"          │
        └────────────────────────┬────────────────────────┘
                                 │ MainThreadNotebookDocuments
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  Extension host / language servers              │
        │    R LSP, Python LSP, markdown LSP, …           │
        │    see cells as vscode-notebook-cell:// URIs    │
        └─────────────────────────────────────────────────┘
```

User sees one document. Language services see a notebook.

---

## 2. Core components

### 2.1 `QmdNotebookProjection` — the shadow model

For each open `.qmd`, instantiate a `NotebookTextModel`
([`notebookTextModel.ts`](src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts))
with a synthetic URI like `quarto-shadow://<path>.qmd`. It is **never bound to a
notebook editor input** — it exists only for LSP purposes.

Each fenced block becomes a `NotebookCellTextModel`
([`notebookCellTextModel.ts`](src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts))
with:

| Field      | Value                                                                 |
| ---------- | --------------------------------------------------------------------- |
| `language` | the fence language (`r`, `python`, …), resolved through `ILanguageService` |
| `uri`      | `CellUri.generate(shadowNotebookUri, handle)` — scheme `vscode-notebook-cell:` |
| `cellKind` | `CellKind.Code` for fences, `CellKind.Markup` for prose chunks       |

The canonical cell-URI scheme is what every existing language client already
filters on, so **no extension changes are required**.

### 2.2 `QmdCellParser` — text → cell structure

A pure function:

```ts
parse(text: string): CellSpec[]

type CellSpec = {
    kind:           'code' | 'markup';
    language:       string;
    contentRange:   IRange;
    fenceOpenRange: IRange | null;
    fenceCloseRange: IRange | null;
};
```

Quarto's grammar is small — `` ```{lang} `` opens, `` ``` `` closes — so a
one-pass line-by-line state machine suffices.

**Incremental mode.** Given the previous parse tree, an
`IModelContentChangedEvent`, and the new text, return a minimal
`{ spliced, edited, unchanged }` delta. The parse state at line `N` depends
only on (a) whether `N` is inside a fence and (b) the fence language, so we
memoize `(lineNumber → parseState)` and on an edit at line `A`, rewind to the
nearest cached state and re-parse forward until the new state matches the
cached state at some line `≥ B`. Edits inside a cell body terminate on the
next line.

### 2.3 `QmdNotebookSync` — the dual-buffer bridge

Listens to `.qmd TextModel.onDidChangeContent`. On each change:

1. **Parse incrementally.** Produce `CellDelta { spliced, edited }`.
2. **Edited cells (content change, no structural change).** Apply equivalent
   `applyEdits()` to the cell's `textBuffer`. The cell's `TextModel` (if
   materialized) fires `onDidChangeContent`
   ([`notebookCellTextModel.ts:161-169`](src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts)),
   `MainThreadNotebookDocuments` forwards to ext host, LSP sees a `didChange`.
3. **Spliced cells (structural change).** Call `notebook.applyEdits([{
   editType: CellEditType.Replace, ... }])`. The existing notebook machinery
   emits the right `didOpen` / `didClose` notifications.
4. **Update `CellMap`** so cursor lookups stay O(log N).

The **reverse direction** — LSP edits to cells (rename, format, code action)
— flows back through the same bridge: write into the cell, re-emit the
equivalent edit on the `.qmd` `TextModel` at the cell's range. A short-lived
re-entrancy flag suppresses the loop when the resulting `onDidChangeContent`
fires.

### 2.4 `CellMap` — position translation

```ts
type CellMap = {
    cellAtLine(line: number):
        | { handle: number; startLine: number; endLine: number; language: string }
        | null;

    qmdToCell(pos: IPosition):
        | { cellUri: URI; positionInCell: IPosition }
        | null;

    cellToQmd(cellHandle: number, range: IRange): IRange;
};
```

Implementation: a sorted array of line ranges (rebuilt on splice) — for
typical `.qmd` files (≤ 100 cells) linear scan is fine; promote to interval
tree only if a profile says so.

The translation is purely line-arithmetic. Cell content starts at
`fenceOpenRange.endLineNumber + 1`, so:

```
positionInCell.lineNumber = qmdPos.lineNumber - fenceOpenLine - 1
positionInCell.column     = qmdPos.column                          // unchanged
```

Columns pass through because fences are line-anchored.

### 2.5 `QmdLanguageFeatureDispatcher` — the LSP router

This is the load-bearing piece. Register one provider per
`LanguageFeatureRegistry` for `{ language: 'quarto' }`. Each provider:

```ts
async provideHover(model, position, token) {
    const loc = cellMap.qmdToCell(position);
    if (!loc) {
        return markdownProviders.invoke(model, position, token);
    }

    const ref = await textModelService.createModelReference(loc.cellUri);
    const cellModel = ref.object.textEditorModel;

    const providers = languageFeaturesService.hoverProvider.ordered(cellModel);
    const results = await Promise.all(
        providers.map(p => p.provideHover(cellModel, loc.positionInCell, token))
    );

    ref.dispose();
    return results.flatMap(r => r ? [translateRanges(r, loc)] : []);
}
```

Provider scoring (`LanguageFeatureRegistry.scored()`) does the work: R LSP is
registered for `{ language: 'r' }`, the materialized cell model has
`languageId === 'r'`, so `providers.ordered(cellModel)` returns the R
provider.

**Features to dispatch (~20 registries):**

| Category   | Features                                                              |
| ---------- | --------------------------------------------------------------------- |
| Reading    | hover, definition, declaration, type-definition, implementation, references |
| Writing    | rename (+ prepare), formatting (range + on-type), code actions (+ resolve) |
| Completion | completion (+ resolve), signature help, inline completions            |
| Visual     | semantic tokens, document highlights, color provider, inlay hints     |
| Structural | document/workspace symbols, code lens (+ resolve), link providers    |

Each dispatcher is ~30 lines and they're nearly identical — a single generic
class parameterized by `(registry, translateResult)` handles most of them.

---

## 3. Data flow walkthroughs

### 3.1 Editing inside a cell body

```
User types 'x' in an R cell at .qmd line 10, col 5
   │
   ▼
.qmd TextModel.applyEdits → onDidChangeContent
   │
   ▼
QmdNotebookSync.handleChange
   │   parser: edit is inside cell K's body, no structure change
   ▼
cell K textBuffer.applyEdits at (line - fenceOpen - 1, col)
   │
   ▼
NotebookCellTextModel.onDidChangeContent fires
   │
   ▼
MainThreadNotebookDocuments → ExtHost
   │
   ▼
R LSP sees textDocument/didChange for vscode-notebook-cell://...
   │
   ▼
diagnostics arrive on cell URI
   │   QmdDiagnosticsReflector mirrors them to the .qmd URI
   ▼
red squigglies render at the right place in the flat editor
```

### 3.2 Hovering on a function name

```
User hovers .qmd at (line 12, col 8) — inside an R cell
   │
   ▼
HoverController invokes hoverProvider.ordered(.qmd model)
   │
   ▼
QmdHoverDispatcher matches { language: 'quarto' }
   │
   ▼
cellMap.qmdToCell → { cellUri: ...&handle=2, positionInCell: (1, 8) }
   │
   ▼
textModelService.createModelReference(cellUri)
   │   resolves shadow notebook → finds cell handle 2
   │   creates TextModel from cell.textBuffer (via CellContentProvider)
   ▼
hoverProvider.ordered(cellModel) → R LSP provider
   │
   ▼
R LSP returns Hover { range: (1, 5)-(1, 12) }   // cell-local
   │
   ▼
cellMap.cellToQmd → (12, 5)-(12, 12)
   │
   ▼
HoverController renders at the right place
```

### 3.3 User types a closing fence (structural change)

**Before**

```text
```{r}
foo()
bar()
```

**After** — user inserts a `` ``` `` line between `foo()` and `bar()`

```text
```{r}
foo()
```
bar()
```

**Flow**

```
parser:
    cell K was lines 1-3 with body "foo()\nbar()"
    cell K is now lines 1-3 with body "foo()"
    new markup cell at line 4 with body "bar()"

CellDelta {
    edited:  [K (content shrunk)]
    spliced: [insert markup cell at index K+1]
}
   │
   ▼
cell K.applyEdits removes "\nbar()" → R LSP sees didChange (deletion)
   │
   ▼
notebook.applyEdits inserts markup cell → markdown LSP sees didOpen
   │
   ▼
CellMap rebuilt
```

---

## 4. Extension-host visibility

The shadow `NotebookTextModel` flows through
[`MainThreadNotebookDocuments`](src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts)
→ [`ExtHostNotebookDocuments`](src/vs/workbench/api/common/extHostNotebookDocument.ts).
Each cell becomes an `ExtHostCell` with a `document` `vscode.TextDocument`
carrying the correct `languageId`.

> **Existing language extensions need zero changes.** Pylance/Pyright already
> register for `{ scheme: 'vscode-notebook-cell', language: 'python' }` and
> fire on our cells the same way they fire on Jupyter cells. Positron's R LSP
> setup already covers notebook cells.

### The notebook-type question

Every `NotebookTextModel` needs a `notebookType`. Two options:

| Option | Pros | Cons |
| --- | --- | --- |
| **Register a `quarto-shadow` type** with no serializer/editor binding | Clean separation; can't accidentally open as notebook UI | Extensions that filter on `notebookType: 'jupyter-notebook'` won't see our cells |
| **Pose as `jupyter-notebook`** | Jupyter-aware tooling treats us identically | Risky — tools may try to execute via the Jupyter kernel; semantic muddle |

**Recommendation:** `quarto-shadow`. Filtering by cell language is the common
case; filtering by notebook type is rare and usually means "execute me," which
we don't want.

---

## 5. File layout

```text
src/vs/workbench/contrib/quartoNotebook/
├── common/
│   ├── qmdCellParser.ts             ← pure parser, unit-testable
│   └── cellMap.ts                   ← line-range index, pure
└── browser/
    ├── qmdNotebookProjection.ts     ← owns shadow NotebookTextModel per .qmd
    ├── qmdNotebookSync.ts           ← listens to .qmd TextModel, drives projection
    ├── qmdLanguageFeatureDispatcher.ts  ← ~20 provider shims
    ├── qmdDiagnosticsReflector.ts   ← cell-URI diagnostics → .qmd-URI diagnostics
    └── quartoNotebook.contribution.ts   ← wires it up as a WorkbenchPhase contribution
```

**Upstream impact.** A single registration line in `workbench.common.main.ts`,
wrapped per the upstream-compat rule:

```ts
// --- Start Positron ---
// Project .qmd source files onto a shadow NotebookTextModel so per-cell
// language servers handle hover/completion/etc.
import './contrib/quartoNotebook/browser/quartoNotebook.contribution.js';
// --- End Positron ---
```

No edits to `CellContentProvider`, `NotebookTextModel`, or the LSP machinery
— they're consumed as-is.

---

## 6. Hard edge cases

| # | Case | Handling |
| --- | --- | --- |
| 1 | **Edit crosses cell boundary** (paste spans a fence) | Parser produces a multi-part delta: edit cell A's tail, splice intervening cells, edit cell B's head. The notebook splice is one transaction; LSP sees a consistent sequence. |
| 2 | **Undo across a structural edit** | The `.qmd` `TextModel` owns undo. After undo, re-run the parser and recompute the delta. Don't try to undo the notebook independently — derive it. |
| 3 | **Multi-cursor edits across cells** | Each cursor's edit is dispatched to its containing cell. The combined `IModelContentChangedEvent` produces the right multi-cell delta in one pass. |
| 4 | **Fence partially typed** (`` ```{r `` missing `}`) | Treat as plain markdown until the closing brace appears. When it does, a structural change fires and the cell springs into being. Expect brief flicker — acceptable. |
| 5 | **Cursor on a fence line** | `cellMap.qmdToCell` returns `null`. Fall back to markdown/quarto providers. Don't route to a code cell. |
| 6 | **Cell language alias** (`{python3}`, `{R}`) | `ILanguageService.getLanguageIdByLanguageName` handles common aliases. Normalize at parse time. |
| 7 | **Inline R code** (`` `r expr` ``) | **Out of scope for v1.** Cell granularity is "fenced block." Inline expressions need a separate mechanism — defer. |
| 8 | **Cross-cell workspace edits** | LSP may return `WorkspaceEdit` with edits across multiple cell URIs. Translate each entry's URI + ranges independently. |
| 9 | **Structural-edit flicker** during rapid typing | Debounce the structural delta path by ~50 ms so holding backspace through a fence doesn't churn the LSP. |
| 10 | **User disables the feature** | Gate behind setting `quarto.notebookProjection.enabled` (default `true`). When off, no shadow model is created. |

---

## 7. Incremental build order

```
   ┌────────────────────────────────────────────────────────────────┐
   │  M1   Parser + CellMap                  (pure, vitest)         │
   │       Corpus test against real .qmd files                      │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M2   Shadow notebook construction      (no sync, no LSP)      │
   │       Debug command dumps cell list for an open .qmd           │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M3   One-way sync, naive                                      │
   │       Rebuild all cells on every change                        │
   │       Verify ext-host sees cells                               │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M4   Incremental structural diff                              │
   │       Replace "rebuild everything" with splice algorithm       │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M5   ★ Hover dispatcher only           ★ proof of concept     │
   │       End-to-end: hover R cell → R LSP → translate back        │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M6   Diagnostics reflector                                    │
   │       Cell-URI diagnostics → .qmd-URI                          │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M7   Remaining ~20 dispatchers          (mostly mechanical)   │
   └──────────────────────────────┬─────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼─────────────────────────────────┐
   │  M8   Reverse sync                                             │
   │       LSP edits → .qmd. Rename + format are the canonical tests│
   └────────────────────────────────────────────────────────────────┘
```

> **M5 is the "is this actually going to work" gate.** If hover and diagnostics
> work end-to-end, the rest is grinding.

---

## 8. Tradeoffs and open questions

### 8.1 Versioning

`NotebookCellTextModel` has its own `_versionId`
([`notebookCellTextModel.ts:136`](src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts))
that the LSP sees as `textDocument.version`. Drive this monotonically from
the `.qmd`'s version — don't let cell versions increment independently or
servers that compare versions get confused. **Watchpoint.**

### 8.2 Memory

A 1000-line `.qmd` with 50 cells holds 50 extra `ITextBuffer`s. Probably
fine. Could be optimized later by lazy buffer materialization (only build a
cell's buffer when the cursor enters it) — at the cost of structural-edit
complexity. Defer.

### 8.3 Save behavior

Saving writes the `.qmd` text. The shadow notebook is never persisted. The
`.qmd` is the source of truth — this is correct.

### 8.4 Reload behavior

If the file is reloaded from disk (external change), tear down and rebuild
the shadow notebook. Hook `IModelService.onModelRemoved` / `onModelAdded`
for the `.qmd` URI.

### 8.5 Residual risk — URI rewriting in results

LSP results often contain URIs:

- `Location[]` from find-references
- `WorkspaceEdit.changes` keyed by URI
- `CodeAction.edit` workspace edits
- `DocumentLink.target`

The dispatcher must **scan every returned URI** and rewrite cell-URI
references back to `.qmd` URIs with translated ranges. Easy to miss a field
on a complex result type.

> **Mitigation.** Build an iterative test suite that exercises each feature
> against real `.qmd` content. Treat "result contains a `vscode-notebook-cell:`
> URI that leaked back to the editor" as a bug class with dedicated coverage.

---

## Appendix — key VS Code internals referenced

| Concern | File | Why it matters |
| --- | --- | --- |
| Cell URI scheme + generate/parse | [`notebookCommon.ts:614-681`](src/vs/workbench/contrib/notebook/common/notebookCommon.ts) | Routing key for LSP dispatch |
| Cell model — buffer + TextModel | [`notebookCellTextModel.ts`](src/vs/workbench/contrib/notebook/common/model/notebookCellTextModel.ts) | What we instantiate per fence |
| Notebook model — splice + change events | [`notebookTextModel.ts`](src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts) | Drives ext-host visibility |
| On-demand cell TextModel creation | [`notebook.contribution.ts:389-439`](src/vs/workbench/contrib/notebook/browser/notebook.contribution.ts) | The precedent we're following |
| Ext-host bridge | [`mainThreadNotebookDocuments.ts`](src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts), [`extHostNotebookDocument.ts`](src/vs/workbench/api/common/extHostNotebookDocument.ts) | How cells become `vscode.TextDocument` |
| Provider scoring (scheme + language) | [`languageSelector.ts`](src/vs/editor/common/languageSelector.ts), [`languageFeatureRegistry.ts`](src/vs/editor/common/languageFeatureRegistry.ts) | Why dispatch "just works" once cells exist |