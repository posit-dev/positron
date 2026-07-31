# Match notebook find against cell text outputs

Addresses https://github.com/posit-dev/positron/issues/10754

### Summary

Notebook-wide find (Cmd/Ctrl+F) in the Positron Notebook Editor now matches the textual outputs of code cells (stdout, stderr, `text/plain` results, and error tracebacks), matching the default behavior of VS Code's notebook find (whose "Code Cell Output" filter is on by default) and JupyterLab.

- New match-source module `findInOutputs.ts`: `findMatchesInOutputText()` runs the search over a cell's plain-text output content using the editor's own `SearchParams`/`Searcher`, so regex, match-case, and whole-word semantics are identical to source matches. Output text comes from the existing `getPlainTextOutputContent()` (ANSI escape codes stripped; non-text outputs like images/HTML/data-explorer are not searched).
- `PositronCellFindMatch` gains a `kind: 'input' | 'output'`. Output matches are appended after the cell's source matches (mirroring the layout of outputs below the editor), count toward the widget's "N of M", and participate in find-next/previous ordering; cursor seeding treats an output match in the cursor's cell as after any editor position.
- Navigating to an output match selects and reveals the cell and expands collapsed outputs. There is no editor range to select, so no editor selection or find decorations are applied; highlighting inside rendered output DOM is left as a follow-up since outputs render through a separate React pipeline.
- Replace stays source-only: `replace()` on an output match advances to the next match without editing, and `replaceAll()` only edits source matches.
- Output changes (`Output`/`OutputItem` notebook model events) now trigger the debounced re-search, so matches update when cells are run or outputs are cleared.

No new find-widget chrome: outputs are searched by default, like upstream's default filter state. Per-source filter toggles are tracked separately in #10779/#10755.

### Release Notes

#### New Features

- Positron Notebooks: find (Cmd/Ctrl+F) now also matches text in cell outputs (#10754)

#### Bug Fixes

- N/A

### Validation Steps

@:positron-notebooks @:web @:win

Manual verification:

1. Open a notebook and run a cell whose output contains a unique term, e.g. `print("zebra")`.
2. Cmd/Ctrl+F and search `zebra`: the match count includes the output match, and navigating to it selects and scrolls to the cell (expanding the output section if it was collapsed).
3. Toggle match case / whole word / regex: output matches obey the toggles like source matches.
4. With a term that appears in both source and output, Replace All rewrites only the source occurrences; output text is untouched and its match remains in the count.
5. Clear the cell's outputs or re-run the cell: the match count updates.
