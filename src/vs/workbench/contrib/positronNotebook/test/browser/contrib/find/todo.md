# Find Controller Test TODOs

Workarounds in the test suite that should be fixed properly.

## 1. wholeWord test bypasses the controller

The `wholeWord=true only matches full words` test calls `cell.model.textModel.findMatches()` directly with hardcoded word separators instead of going through the controller's `research()` method. This is because `TestConfigurationService` doesn't have `editor.wordSeparators` configured, so the controller passes `null` for word separators, which disables whole-word matching entirely.

**Fix**: Configure `editor.wordSeparators` in the test instantiation service (or in each test via the config service stub) so the controller's `research()` path works end-to-end with `wholeWord=true`.

## 2. State isolation tests don't use multiple notebook instances

The plan calls for verifying that two notebook instances keep independent match state, decorations, and visibility. The current tests use single-instance lifecycle checks instead. Creating two `createTestPositronNotebookEditor` instances in the same test causes `DISPOSABLE is tracking error!` from disposable tracking conflicts in the shared workbench service layer (e.g., `TestFilesConfigurationService`, `LanguagesRegistry`).

**Fix**: Either make `createTestPositronNotebookEditor` share an instantiation service between instances (accepting a pre-built one as an optional parameter), or isolate the global service registrations so two instances can coexist without tracking conflicts.

## 3. Debounce tests manually trigger the content change scheduler

`cell.model.textModel.setValue()` does not fire `NotebookTextModel.onDidChangeContent` in the test environment. In production, cell text model changes propagate through `NotebookCellTextModel.onContentChanged` → `NotebookTextModel.onDidChangeContent` → controller's debounce scheduler. In tests, the text model created by `createTestNotebookCellTextModel` is not wired back into this event chain. The tests work around this by calling `internals(controller)._notebookContentChangedScheduler.schedule()` manually after each `setValue()`.

**Fix**: Wire the test text model's `onDidChangeContent` event back to `NotebookCellTextModel` so that `setValue()` triggers the full `NotebookCellTextModel → NotebookTextModel → controller` event chain, matching production behavior.
