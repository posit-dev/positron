---
paths:
  - src/**/*.{test,integrationTest}.{ts,tsx}
---

# Core Tests

Core Positron unit/integration tests in `src/`, run via `./scripts/test.sh`.

## Disposables

Every test suite must call `ensureNoDisposablesAreLeakedInTestSuite()`. Capture the return value if tests create disposables:

```typescript
const disposables = ensureNoDisposablesAreLeakedInTestSuite();
disposables.add(someDisposable);
```

## Services (prefer in this order)

1. `{} as T` for services the code under test doesn't call (e.g. dependencies it only passes through to collaborators).
2. Real services directly (e.g. `new RuntimeStartupService(...)`).
3. Existing `Test*` service classes - search from `src/vs/workbench/test/browser/positronWorkbenchTestServices.ts`.
4. For many dependencies, use `positronWorkbenchInstantiationService`.

## Structure

- Group related tests with nested `suite()` calls, not comment headers like `// --- Section ---`.

## Mocking

- Use `Partial<T>` with only the members your test needs, cast with `as T`. This might trigger `local/code-no-dangerous-type-assertions`; add `/* eslint-disable local/code-no-dangerous-type-assertions */` below the copyright header.
- For reusable mocks, create a test helper class implementing `Partial<T>`.

## Sinon

Prefer events/state to verify behavior (e.g. await `TestCommandService.onWillExecuteCommand` instead of stubbing `executeCommand`). Use sinon when no observable signal exists.

## Async

- Await events with `Event.toPromise(event)` instead of timeouts.
- For debounce/throttle/scheduler logic, use `runWithFakedTimers`.
