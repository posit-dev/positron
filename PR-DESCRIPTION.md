# Prevent notebook scroll jump when toggling markdown cell edit/view mode

Addresses https://github.com/posit-dev/positron/issues/10293

### Summary

Toggling a markdown cell between edit and view mode in the Positron Notebook Editor jumped the notebook scroll position. The jump came from the browser's native "reveal on focus": focusing a cell's container (or the editor focus trap) without `preventScroll` scrolls the nearest scrollable ancestor to bring the whole element into view. For markdown cells that are taller than the viewport or only partially visible, that snaps the notebook to the cell's nearest edge:

- Entering edit mode: the first click of the double-click selects the cell, and `NotebookCellWrapper`'s focus-management effect called `cellElement.focus()` with no options.
- Exiting edit mode (Escape / toggling back to view): `CellEditorMonacoWidget`'s exit-editor focus restore called `focusTarget.focus()` / `cell.container.focus()` with no options, while the cell still had the (tall) editor mounted.

The Monaco side of this problem was already fixed for #14085 (the hidden edit-context node's focus saves and restores ancestor scroll positions in `nativeEditContextUtils.ts`), but the React-side container focus calls were never protected.

The fix passes `{ preventScroll: true }` at those call sites (plus the wrapper's multi-select click refocus, which has the same hazard). Container focus never needs to scroll: deliberate reveals go through `cell.reveal()` (keyboard navigation via the selection machine, programmatic reveals via `setOptions` / outline), matching the existing precedent in `PositronNotebookInstance.grabFocus()`. As a side effect this also keeps the viewport stable when deleting a cell (focusing the neighbor cell no longer scrolls), which is the other half of #10293's acceptance criteria.

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- Positron Notebooks: keep the scroll position stable when toggling a markdown cell between edit and view mode (#10293)

### Validation Steps

@:notebooks @:positron-notebooks

jsdom cannot observe focus-induced scrolling, so the new vitest coverage asserts the focus contract instead (all cell-container focus calls pass `preventScroll`). Manual verification:

1. Open a notebook in the Positron Notebook Editor with a markdown cell taller than the viewport (or scroll so a markdown cell is only partially visible).
2. Double-click the rendered markdown to edit it: the viewport should not jump.
3. Press Escape (or toggle back to view mode): the viewport should stay put.
4. Delete a cell mid-notebook: the scroll position should not move.
