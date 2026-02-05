# Inline Data Explorer for Notebooks

Render interactive data grids directly in notebook cell outputs when a cell returns a pandas/polars DataFrame/Series. Users can scroll, sort, and open the full Data Explorer - all inline without leaving the notebook.

## Key Files

- `extensions/positron-python/.../positron_ipkernel.py` - Python kernel integration (detects dataframes, creates comm)
- `src/vs/.../notebookCells/InlineDataExplorer.tsx` - Main React component for inline rendering
- `src/vs/.../positronDataExplorer/browser/inlineTableDataGridInstance.tsx` - Simplified DataGridInstance for inline display
- `src/vs/.../positronNotebook/browser/NotebookCodeCell.tsx` - Renders InlineDataExplorer for dataframe outputs
- `src/vs/.../positronNotebook/browser/getOutputContents.ts` - Parses MIME type
- `src/vs/.../positronNotebook/common/positronNotebookConfig.ts` - Feature settings
- `src/vs/.../positronDataExplorerService.ts` - Async instance retrieval
- `test/e2e/tests/notebooks-positron/notebook-inline-data-explorer.test.ts` - E2E tests

## Architecture

- **MIME type:** `application/vnd.positron.dataExplorer+json` - separates data explorer outputs from standard HTML/text
- **Comm-based:** Reuses existing data explorer comm pattern for kernel communication
- **Simplified grid:** `InlineTableDataGridInstance` disables resize/pinning but keeps sorting
- **Instance lifecycle:** Managed by kernel/runtime, not by editor. Inline and full Data Explorer share the same `DataExplorerClientInstance`.
- **Async retrieval:** `getInstanceAsync(commId, timeout)` handles race condition where comm registration is async
- **Stale detection:** Grid detects when data connection is lost and shows "stale" message

## Configuration

Feature is behind `positron.notebooks.inlineDataExplorer.enabled` setting. See `positronNotebookConfig.ts` for all settings.

## E2E Test Coverage

Tests in `test/e2e/tests/notebooks-positron/notebook-inline-data-explorer.test.ts`:

| Scenario | Status |
|----------|--------|
| DataFrame rendering | Covered |
| Header row/column counts | Covered |
| Scroll isolation | Covered |
| Open full Data Explorer | Covered |
| Copy single cell | Covered |
| Copy cell range (Shift+click) | Covered |
| Copy column via context menu | Covered |
| Copy row via context menu | Covered |
| Column sorting | NOT covered |
| R DataFrames | NOT covered |
| Error/stale states | NOT covered |

## Related Docs

- PRD: `thoughts/shared/prds/2026-02-04-inline-data-explorer-notebooks.md`
- Research: `thoughts/shared/research/2026-02-04-inline-data-explorer-notebooks.md`
