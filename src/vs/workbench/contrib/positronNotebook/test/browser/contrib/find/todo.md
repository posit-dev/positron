# Find Controller Test TODOs

Workarounds in the test suite that should be fixed properly.

## 1. State isolation tests don't use multiple notebook instances

The plan calls for verifying that two notebook instances keep independent match state, decorations, and visibility. The current tests use single-instance lifecycle checks instead. Creating two `createTestPositronNotebookEditor` instances in the same test causes `DISPOSABLE is tracking error!` from disposable tracking conflicts in the shared workbench service layer (e.g., `TestFilesConfigurationService`, `LanguagesRegistry`).

**Fix**: Either make `createTestPositronNotebookEditor` share an instantiation service between instances (accepting a pre-built one as an optional parameter), or isolate the global service registrations so two instances can coexist without tracking conflicts.
