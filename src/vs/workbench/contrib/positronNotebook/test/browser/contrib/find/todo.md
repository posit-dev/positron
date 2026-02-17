# Find Controller Test TODOs

Workarounds in the test suite that should be fixed properly.

## 1. State isolation tests don't use multiple notebook instances

The plan calls for verifying that two notebook instances keep independent match state, decorations, and visibility. The current tests use single-instance lifecycle checks instead. Creating two `createTestPositronNotebookEditor` instances in the same test causes `DISPOSABLE is tracking error!` from disposable tracking conflicts in the shared workbench service layer (e.g., `TestFilesConfigurationService`, `LanguagesRegistry`).

**Fix**: Either make `createTestPositronNotebookEditor` share an instantiation service between instances (accepting a pre-built one as an optional parameter), or isolate the global service registrations so two instances can coexist without tracking conflicts.

## 4. Tests access private controller state via `internals()` cast

The `internals()` helper casts the controller to `any` to access private members. This couples tests to private implementation details and breaks if internals are renamed or restructured.

Private members accessed:
- ~~`_findInstance` — to set search params (reactive tests) and read visibility/focus state~~ **Done**: exposed as public `findInstance` getter on the controller
- ~~`_matches` / `_currentMatch` — to read match state for assertions~~ **Done**: exposed as public `IObservable` properties on the controller
- `research()` — to trigger synchronous search (direct API tests)
- ~~`_notebookContentChangedScheduler` — to simulate content change debounce~~ **Done**: event chain works in test harness; debounce tests use fake timers

**Fix**: For the remaining private accesses, create a `TestPositronNotebookFindController` subclass or expose additional public API as appropriate.
