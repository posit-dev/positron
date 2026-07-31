# Seed the notebook find input from the cell editor selection

Addresses https://github.com/posit-dev/positron/issues/15145

### Summary

In the Positron Notebook Editor, pressing Cmd+F opened the find widget with an empty input, ignoring the current selection in the cell editor. VS Code's text editor and the built-in notebook editor both seed the find input from the selection per `editor.find.seedSearchStringFromSelection`.

- `PositronNotebookFindController.start()` now seeds the find input from the editing cell editor's selection before showing the widget, reusing the editor contrib's `getSelectionSearchString()` and mirroring the built-in notebook editor's semantics:
  - `always` (default): seeds from a single-line selection, or the word at the cursor when the selection is empty
  - `selection`: seeds only from a non-empty single-line selection
  - `never`: never seeds
  - Multi-line selections never seed; the seeded text is regex-escaped when regex mode is on; seeding only happens in edit mode so a stale command-mode selection can't overwrite the query
- The seeded search runs immediately (match count and decorations update) via the existing research autorun
- `PositronFindInput` now selects the input text when the value changes externally while the input is focused, so Cmd+F with the widget already open leaves the seeded text selected and typing replaces it (matching the editor find widget)

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- Positron Notebooks: Cmd/Ctrl+F now populates the Find input with the current cell editor selection (#15145)

### Validation Steps

@:positron-notebooks @:web @:win

In a Positron notebook, enter a cell, select some single-line text, and press Cmd/Ctrl+F: the Find input contains the selected text (fully selected, typing replaces it) and matches highlight immediately. Also verify: an empty selection with the cursor on a word seeds that word; a multi-line selection does not seed; with `"editor.find.seedSearchStringFromSelection": "never"` nothing is seeded; pressing Cmd/Ctrl+F again with a new selection while the widget is open re-seeds.
