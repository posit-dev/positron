# Reveal the matching line when notebook find navigates to a match

Addresses https://github.com/posit-dev/positron/issues/14130

### Summary

In the Positron Notebook Editor, find/replace navigation jumped to the correct cell but not to the matching line: with a cell taller than the viewport, the active match could stay off-screen. Three things conspired:

- Cell editors auto-grow to fit their content (`CellEditorMonacoWidget` lays the editor out at its content height), so the editor never scrolls internally and the `editor.revealRangeInCenter()` call in `navigateToMatch()` could not move anything.
- The notebook-level reveal was cell-granularity only: `cell.reveal()` scrolls the cell's container into view (`scrollIntoView({ block: 'center' })`), which for an oversized cell shows the middle of the cell regardless of where the match is.
- For a cell whose editor was not attached yet (e.g. a rendered markdown cell), the selection and reveal were skipped entirely and never retried (documented by the two `it.fails` tests added in #14214).

The fix reveals at line granularity through the notebook's scroll container, which is the only viewport that can bring a line into view:

- `ICellRevealOptions` gains an optional `range`. When set and the cell's editor is attached, `cell.reveal()` computes the match lines' pixel range within the cells container (editor DOM offset + `getTopForLineNumber`/`getBottomForLineNumber`) and scrolls so the range is centered when outside the viewport, mirroring Monaco's "reveal in center if outside viewport" behavior. The viewport math lives in an exported pure function, `computeRangeRevealScrollTop`.
- The find controller's `navigateToMatch()` now selects the match and calls `cell.reveal()` with the match range. When the editor is not attached yet, it reveals the cell immediately and applies the selection + line reveal once the editor attaches (one pending watcher, staleness-guarded, replaced on each navigation and cleared on hide).

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- Positron Notebooks: find/replace now scrolls to the matching line within a cell, not just to the cell (#14130)

### Validation Steps

@:positron-notebooks @:web @:win

Viewport geometry isn't observable in the unit-test DOM, so the scroll math is unit-tested as a pure function and the wiring via reveal/selection contracts (the two `it.fails` tests from #14214 are flipped to passing). Manual verification (repro from #14130):

1. Open `qa-example-content/workspaces/pokemon/ds-workflow1.ipynb` in the Positron Notebook Editor.
2. Scroll so that the first `base_total_arr` in the long "4. Feature Engineering" code cell is off-screen but a later instance is visible.
3. Cmd/Ctrl+F, search `base_total_arr`, and navigate with the up/down arrows: each navigation should scroll the matching line into view (centered) with the match selected, including inside cells taller than the viewport.
4. Matches in rendered markdown cells still reveal the cell; the line reveal applies once the cell's editor opens.
