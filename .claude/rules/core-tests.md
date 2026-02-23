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

1. Real services directly (e.g. `new RuntimeStartupService(...)`).
2. Existing `Test*` service classes - search from `src/vs/workbench/test/browser/positronWorkbenchTestServices.ts`.
3. For many dependencies, use `positronWorkbenchInstantiationService`.

## Mocking

- Use `Partial<T>` with only the members your test needs, cast with `as T`.
- For reusable mocks, create a test helper class implementing `Partial<T>`.

## Sinon

Prefer events/state to verify behavior (e.g. await `TestCommandService.onWillExecuteCommand` instead of stubbing `executeCommand`). Use sinon when no observable signal exists.

## Async

- Await events with `Event.toPromise(event)` instead of timeouts.
- For debounce/throttle/scheduler logic, use `runWithFakedTimers`.
