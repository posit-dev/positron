Addresses https://github.com/posit-dev/positron/issues/10508 and https://github.com/posit-dev/positron/issues/10474

Both bugs are already fixed on main. This PR adds the regression coverage needed to close them with confidence; there are no product code changes.

### Verification

**`%%html` with inline `<script>` breaks renderer (#10508)**
At filing time, script-bearing HTML rendered inline through the React pipeline and an exception during render unmounted the whole cell list. Two later changes fixed this:
- #12886 routes any HTML with active content (scripts, iframes, inline event handlers, `javascript:` URLs, detected by `isComplexHtml` in `src/vs/workbench/services/positronIPyWidgets/common/webviewPreloadUtils.ts`) into a sandboxed overlay webview with scripts enabled (`htmlRenderMode` in `PositronNotebookCells/notebookOutputUtils.ts` -> `PositronNotebookCodeCell.parseCellOutputs`).
- #12282 wrapped each output in a per-output `NotebookErrorBoundary` (`NotebookCodeCell.tsx`), so a bad output can no longer take down the notebook.

**`IPython.display.Image` excessively zoomed (#10474)**
At filing time, inline `<img>` outputs had no scaling constraint, so wide images overflowed and appeared zoomed/cropped. #12539 added `& > img { max-width: 100%; height: auto; }` to `NotebookCodeCell.css`, and `parseOutputData` (`getOutputContents.ts`) now honors explicit width/height from output metadata.

### New tests

- vitest (`positronNotebookCellOutputs.vitest.ts`): a script-bearing HTML fragment produces a `preloadMessageResult` (webview routing) instead of rendering inline.
- e2e (`notebook-cell-output.test.ts`): the exact `%%html` + `<script>` repro from the issue executes inside the webview (script output visible) and the notebook keeps working afterwards (a subsequent cell is added and runs).
- e2e (`notebook-cell-output.test.ts`): a 3000px-wide `IPython.display.Image` PNG decodes at natural size but renders scaled down to its output container.

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- N/A (test-only change; regression coverage for #10508 and #10474)

### Validation Steps

@:positron-notebooks

1. Run the new tests: `npx playwright test test/e2e/tests/notebooks-positron/notebook-cell-output.test.ts --project e2e-electron` and `npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCellOutputs.vitest.ts`.
2. Manual spot check: in a Positron notebook, run the `%%html` + `<script>` repro from the first issue; the script output renders and later cells still work. Then `display(Image(...))` with a very wide PNG; the image scales to the cell width.
