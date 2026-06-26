# Plan: Save Plot & Open Output in New Tab in Positron Notebook Editor

Issue: https://github.com/posit-dev/positron/issues/12841

## Goal

Bring two plot/output actions that already exist for Quarto inline output to the
Positron Notebook editor, so the two editors are consistent where they overlap:

1. **Open output in new tab** — opens the plot image in a new editor tab.
2. **Save plot** — opens a save dialog and writes the plot image to disk.

Both should appear for image (plot) outputs in the notebook cell output action
bar (the hover toolbar on each output) and in the output right-click context
menu, alongside the existing "Copy Image" action.

## Background / Current State

### Notebook cell output actions
- Output action bar is rendered by
  `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/CellOutputActionBar.tsx`,
  which pulls actions from `MenuId.PositronNotebookCellOutputActionBar`.
- Output right-click context menu uses
  `MenuId.PositronNotebookCellOutputActionContext`.
- Actions are registered in
  `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`
  as subclasses of `NotebookAction2`. Existing examples to mirror:
  - `CopyOutputImageAction` (id `positronNotebook.cell.copyOutputImage`) —
    shows for image outputs, reads the image `dataUrl` either from a forwarded
    context-menu arg (`CopyImageMenuArg`) or from the first image output.
  - `ClearOutput`, `CopyOutputJson`, etc.
- Action groups live in
  `src/vs/workbench/contrib/positronNotebook/common/positronNotebookCommon.ts`:
  `PositronNotebookCellOutputActionGroup { Copy='0_copy', Visibility='1_visibility', Destructive='2_destructive' }`.
  Action IDs are enumerated in `PositronNotebookActionId`.
- Context keys (`CellContextKeyManager.ts`):
  - `CellContextKeys.imageOutputCount` (number of image outputs in cell)
  - `CellContextKeys.outputImageTargeted` (right-clicked element is an image)
  - `CellContextKeys.outputIsCollapsed`
- Image targeting for the context menu: `NotebookCodeCell.tsx` computes the
  targeted image `dataUrl` on `contextmenu` and forwards a `{ imageDataUrl }`
  arg into the menu action.

### Parsed image output
- `getOutputContents.ts` parses outputs into `ParsedOutput`. Image outputs:
  - PNG: `{ type: 'image', dataUrl: 'data:image/png;base64,<...>', width?, height? }`
  - SVG: `{ type: 'image', dataUrl: 'data:image/svg+xml,<url-encoded>' }` (NOT base64)
- Type defined in `IPositronNotebookCell.ts` (`ParsedOutput`).
- The parsed image type does **not** carry an explicit `mimeType`; the MIME type
  must be derived from the `dataUrl` prefix (`data:image/png;...`,
  `data:image/svg+xml,...`).

### Reference implementation (Quarto)
`src/vs/workbench/contrib/positronQuarto/browser/quartoOutputManager.ts`:
- `_savePlot(dataUrl, mimeType, cellId, targetPath?)` — derives extension from
  mime, builds default filename `<doc>_cell<index>.<ext>`, shows
  `IFileDialogService.showSaveDialog`, decodes base64, writes via
  `IFileService.writeFile`, toasts success/failure.
- `_openPlotInEditor(dataUrl, mimeType, cellId)` — decodes base64 to bytes,
  writes a temp file (`.positron-temp-<filename>` next to the doc) and opens it
  with `IEditorService.openEditor({ resource })`.
- Helpers `_getExtensionForMimeType` and `_extractBase64FromDataUrl`.
- Quarto copy/svg note: notebook SVG `dataUrl`s are URL-encoded, not base64.
  `copyImageUtils.ts#toBase64DataUrl` already normalizes this for clipboard;
  save/open must handle the same case.

### Notebook instance
- `IPositronNotebookInstance.uri` gives the notebook document URI (used for
  default save dir/filename).

## Design

Add two new `NotebookAction2`s in `positronNotebook.contribution.ts`, modeled on
`CopyOutputImageAction`, and extract shared image-saving / opening helpers into a
small util module so logic is testable and not duplicated from Quarto.

### 1. New util module: `notebookImageOutputUtils.ts`
Location: `src/vs/workbench/contrib/positronNotebook/browser/notebookImageOutputUtils.ts`

Exports (pure-ish helpers taking services as args, like `copyImageUtils.ts`):
- `imageExtensionFromDataUrl(dataUrl): string` — `.png` / `.svg` / `.jpg` /
  `.gif` / `.webp`, default `.png`, parsed from the `data:` prefix.
- `imageBytesFromDataUrl(dataUrl): Uint8Array | undefined` — decode base64 OR
  URL-encoded SVG (reuse/borrow the `toBase64DataUrl` normalization, then
  `decodeBase64`).
- `defaultImageFileName(notebookUri, cellIndex, ext): string` —
  `<docNameNoExt>_cell<index><ext>`.
- `savePlotFromDataUrl({ dataUrl, notebookUri, cellIndex }, fileDialogService, fileService, logService, notificationService): Promise<boolean>`
  — full save flow (dialog + write + toast). Returns false on cancel.
- `openPlotInEditorFromDataUrl({ dataUrl, notebookUri, cellIndex }, fileService, editorService): Promise<void>`
  — write temp file next to the document and open it.

(Keep `CopyImageMenuArg`/targeting reuse from `copyImageUtils.ts`; the existing
forwarded `{ imageDataUrl }` arg is enough to know which image was targeted.)

### 2. Register `SavePlotAction`
- Id: add `SaveOutputImage = 'positronNotebook.cell.saveOutputImage'` to
  `PositronNotebookActionId`.
- Title: "Save Plot" (matches Quarto wording in the issue). Icon: `Codicon.save`.
- Menus (mirror `CopyOutputImageAction`):
  - `PositronNotebookCellOutputActionBar`, group `Copy` (order after Copy Image,
    e.g. order 3), `when`: `imageOutputCount == 1 && !outputIsCollapsed`.
  - `PositronNotebookCellOutputActionContext`, group `Copy`, `when`:
    `outputImageTargeted && !outputIsCollapsed`.
- `runNotebookAction`: resolve `dataUrl` from forwarded `CopyImageMenuArg` else
  first image output (same fallback as Copy Image). Resolve `cellIndex` from
  active cell. Call `savePlotFromDataUrl(...)`.

### 3. Register `OpenOutputInNewTabAction`
- Id: add `OpenOutputInNewTab = 'positronNotebook.cell.openOutputInNewTab'`.
- Title: "Open Output in New Tab" (matches Quarto). Icon: `Codicon.linkExternal`.
- Menus: same `when` conditions and groups as Save Plot (image only for v1).
- `runNotebookAction`: resolve `dataUrl`/`cellIndex`, call
  `openPlotInEditorFromDataUrl(...)`.

### Scope decision for v1
- Image (plot) outputs only, to directly satisfy the issue. Text/HTML popout
  (which Quarto also supports) is out of scope here; can be a follow-up.
- Show the action-bar buttons only when the cell has exactly one image output
  (consistent with the existing static "Copy Image" button); the context-menu
  entries handle the multi-image case via `outputImageTargeted`.

## Files to change

- `src/vs/workbench/contrib/positronNotebook/common/positronNotebookCommon.ts`
  - Add `SaveOutputImage`, `OpenOutputInNewTab` to `PositronNotebookActionId`.
- `src/vs/workbench/contrib/positronNotebook/browser/notebookImageOutputUtils.ts` (new)
  - Save/open/extension/decode helpers.
- `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`
  - Register `SavePlotAction` and `OpenOutputInNewTabAction`; add needed imports
    (`IFileDialogService`, `IEditorService`, `Codicon` already imported, etc.).

## Tests

- New vitest: `test/browser/notebookImageOutputUtils.vitest.ts`
  - `imageExtensionFromDataUrl` for png/svg/jpg/unknown.
  - `imageBytesFromDataUrl` for base64 PNG and URL-encoded SVG.
  - `defaultImageFileName` formatting.
- Extend `test/browser/notebookCells/CellOutputActionBar.vitest.tsx` (or a new
  menu-registration test) to assert the Save Plot / Open in New Tab actions are
  contributed to `PositronNotebookCellOutputActionBar` for an image output and
  hidden when collapsed / no image.
- Consider a save-flow test using a stub `IFileDialogService`/`IFileService`
  (mirrors Quarto's `targetPath` test seam) — the util takes services as args so
  it's straightforward to unit test the write + filename logic.

## Verification

- Build/lint the changed TS.
- Run the new + existing notebook output vitest suites:
  `./scripts/test-vitest.sh` (or the repo's vitest runner) scoped to
  `positronNotebook`.
- Manual smoke test via the `launch` skill: run a cell producing a matplotlib
  plot, hover the output, confirm Save Plot opens a dialog and writes the file,
  and Open Output in New Tab opens the image in a new editor tab. Repeat with an
  SVG plot to confirm the URL-encoded path works. Check the right-click context
  menu on an image with multiple image outputs.

## Open questions

- Temp-file approach for "Open in New Tab" matches Quarto but leaves a
  `.positron-temp-*` file beside the document. Confirm whether to (a) follow
  Quarto as-is, (b) clean up the temp file on editor close, or (c) prefer the
  native notebook "Output Preview" editor instead. Default: follow Quarto for
  consistency, file a follow-up for cleanup if needed.
- Exact button ordering/grouping vs. Copy Image in the action bar — confirm with
  design/issue screenshots.
