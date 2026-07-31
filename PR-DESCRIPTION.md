# Add regression coverage for closing dirty notebooks with Don't Save

Addresses https://github.com/posit-dev/positron/issues/9875.

The behavior reported in #9875 (choosing "Don't Save" when closing a dirty
Positron notebook kept the edits in memory, so reopening the notebook showed
them again) no longer reproduces on main. It was verified end-to-end with a
real save-confirmation dialog (`window.dialogStyle: custom`, no smoke-test
driver): edit -> close -> "Don't Save" -> file on disk unchanged -> reopen
shows the original content, not dirty. Variants covered: structural edits,
waiting for a working-copy backup before closing, Close All Editors on a
non-active notebook. Fault-injection runs (forcing
`PositronNotebookEditorInput#revert` to soft-revert or throw) confirmed the
in-memory model is destroyed on close and cannot be resurrected on reopen, so
the leak behind the original symptom is gone (fixed by the notebook
instance/input lifecycle decoupling work, e.g. #11946).

This PR adds regression coverage so it stays fixed:

- e2e: closing a dirty Positron notebook without saving discards changes. The
  e2e environment auto-answers the save prompt with "Don't Save"
  (`skipDialogs` in `AbstractFileDialogService`), which exercises the same
  `EditorInput#revert` path as a user clicking the button. Asserts the file on
  disk is untouched and the reopened notebook is clean.
- vitest: `PositronNotebookEditorInput` dirty/revert contract - `isDirty()`
  reflects the model, `revert()` forwards to the model and leaves the input
  clean (a still-dirty input after revert vetoes the close), options are
  forwarded, no-ops when clean or unresolved, `dispose()` releases the model
  reference. Mutation-checked: a no-op revert fails the suite.

Recommend closing #9875 after QA re-verifies on a current build.

### Release Notes

#### New Features

- N/A

#### Bug Fixes

- N/A

### Validation Steps

Re-run the issue's steps on a current build: edit a saved Positron notebook,
close the tab, choose "Don't Save", reopen. The edits should be gone and the
notebook clean; the file on disk should be unchanged.

@:positron-notebooks @:win
