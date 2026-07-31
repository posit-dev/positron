Addresses https://github.com/posit-dev/positron/issues/12109

### Summary

When the Positron notebook editor is the frontend for `.ipynb` files, the workspace Search view previously treated open notebooks as raw JSON on disk: matches showed escaped JSON source strings, and clicking a match opened the notebook without navigating to the matched cell. Upstream's open-notebook search only covers `NotebookEditorWidget` instances (the VS Code notebook editor), which Positron notebook editors are not.

This PR makes the Search view notebook-aware for Positron notebooks:

- Adds `positronNotebookSearch.ts`, which searches renderer-resolved notebook models cell by cell, honoring the query's regex/case/whole-word flags, include/exclude patterns, the notebook input/output filters, and `maxResults`. It produces the same cell-based result shape (`INotebookFileMatchNoModel`) as the upstream closed-notebook search, so results render as cell source lines and reflect unsaved edits.
- Wires those results into `NotebookSearchService.notebookSearch` when Positron notebooks are enabled (`positron.notebook.enabled`), and marks the notebooks as scanned so the raw JSON text search is suppressed for them.
- Makes clicking a search result in a Positron notebook editor reveal the matched cell and select the matched range in the cell's editor (`openSearchMatchInPositronNotebook`, called from `SearchView.open`). Output matches reveal the cell.
- Hardens `CellMatch.hasCellViewModel` so matches without a cell view model report as read-only; their ranges are cell-relative, and replacing at those ranges in the raw notebook file would corrupt it.

Follow-ups (not in this PR):

- Closed notebooks still show raw JSON matches unless the upstream experimental setting `search.experimental.closedNotebookRichContentResults` is enabled (acceptance criterion 2 of the issue).
- Replace into Positron notebook matches is intentionally disabled (matches are read-only) until a safe cell-model replace path exists.
- Output matches reveal the cell but do not highlight the match inside the rendered output.

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- The Search view now shows cell-based matches for notebooks open in Positron notebook editors instead of raw JSON, and clicking a match navigates to the matched cell and selects the matched text (#12109)

### Validation Steps

@:search @:positron-notebooks

1. Enable Positron notebooks: set `positron.notebook.enabled` to true and reload.
2. Open a workspace containing an `.ipynb` file and open it in the Positron notebook editor.
3. Search (Cmd/Ctrl+Shift+F) for a term that appears in cell sources. Verify matches show cell source lines (not escaped JSON), including unsaved edits.
4. Click a match: the notebook editor scrolls to the matched cell and selects the matched text in the cell's editor.
5. Run a cell producing text output containing the term and search again: the output match appears, and clicking it reveals the cell.
6. Use the search view's funnel filters (markdown input / cell input / cell output) and confirm matches are filtered accordingly.
7. Verify Replace All does not modify matches inside the open Positron notebook (they are read-only).

Unit coverage: `npx vitest run src/vs/workbench/contrib/search/test/browser/positronNotebookSearch.vitest.ts` (12 tests covering match ranges, filters, flags, maxResults/limitHit, dedupe, and open-to-cell navigation).
