Addresses #10779 (https://github.com/posit-dev/positron/issues/10779) and #10755 (https://github.com/posit-dev/positron/issues/10755)

> **Stacked PR**: this branch is based on `feature/notebook-find-in-outputs` (find-in-outputs for #10754). Merge that PR first; only the "add find filters" commit is new here.

### Summary

Adds find filters to the Positron notebook find widget, mirroring upstream VS Code's notebook Find Filters menu:

- A filter button next to the match count opens a menu with four checkable filters: Markdown Source, Rendered Markdown, Code Cell Source, and Code Cell Output. The button is highlighted while the filters differ from the setting's defaults.
- Filter semantics mirror upstream: code cell source matches follow Code Cell Source; markdown cells being edited follow Markdown Source; rendered markdown cells match while either markdown filter is enabled (the source text stands in for the rendered preview, since Positron notebooks render markdown through React and there is no rendered-DOM search); Code Cell Output gates the output matches added by the find-in-outputs layer.
- The existing `notebook.find.filters` setting provides the default filter state, exactly the setting requested in the issue. Unlike upstream (which reads it once at widget construction), it is read live: changing the setting updates matches immediately. Widget toggles override the setting for the rest of the notebook session.
- Since the setting now applies to Positron notebooks, its "Legacy" settings badge is replaced with the positronNotebook filter tag.

### Release Notes

#### New Features

- Positron Notebooks: the find widget (Cmd/Ctrl+F) has filter toggles for markdown source, rendered markdown, code cell source, and code cell output, with defaults provided by the `notebook.find.filters` setting (#10755, #10779)

#### Bug Fixes

- N/A

### Validation Steps

@:positron-notebooks @:web @:win

1. Open a notebook with a markdown cell (`# zebra notes`), a code cell `zebra = 1`, and a code cell `print("zebra")` (run it).
2. Cmd/Ctrl+F and search `zebra`: the count includes the markdown, code source, and output matches.
3. Click the filter button next to the match count and uncheck "Code Cell Output": the output match leaves the count, and the filter button is highlighted while filters differ from the defaults.
4. Uncheck "Markdown Source" and "Rendered Markdown": the markdown match disappears. Re-check "Rendered Markdown": it returns while the cell is rendered. Enter edit mode on the markdown cell: the match disappears again (editing cells follow "Markdown Source").
5. With the find widget open, set `"notebook.find.filters": { "codeSource": false }` in settings: the code source matches drop immediately (the setting is read live). Toggling "Code Cell Source" back on in the widget overrides the setting for the session.
