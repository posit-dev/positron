---
paths:
  - src/**/*.{test,integrationTest}.{ts,tsx}
---

# Core Tests

Core Positron unit/integration tests in `src/`, run via `./scripts/test.sh`.

## The Builder

Use `createTestContainer()` from `src/vs/workbench/test/browser/positronTestContainer.ts` for any test that needs services. Pick the lowest preset that covers your dependencies:

- **Bare** (no preset) -- pure logic, no services
- `.withRuntimeServices()` -- language runtime + session services (~18)
- `.withNotebookServices()` -- runtime + notebook/kernel services (+8)
- `.withWorkbenchServices()` -- full Positron stack (124+)

Use `.stub(IService, impl)` to add or override individual services after any preset.

```typescript
const ctx = createTestContainer().withRuntimeServices().build();
```

**Important:** `ctx` uses lazy getters. Access `ctx.instantiationService` inside `setup`/`test`, not at suite-level via destructuring.

**When to add a new preset:** When 3+ test files across different directories need the same non-trivial stubs (emitters, real instances) for a recognizable domain. If only 1-2 files need extra services, use `.stub()` instead.

## Disposables

The builder calls `ensureNoDisposablesAreLeakedInTestSuite()` automatically. If you're not using the builder, call it yourself:

```typescript
const disposables = ensureNoDisposablesAreLeakedInTestSuite();
disposables.add(someDisposable);
```

## Mocking

Build mocks incrementally -- see the "How to mock" section in `CLAUDE.md`. In short:

1. Start with a preset and run the test
2. If a service is missing, add an empty stub: `.stub(IService, {} as IService)`
3. If a method is called, add just that method
4. If an event is subscribed, add an `Emitter`

Use `Partial<T>` with only the members your test needs, cast with `as T`. This may trigger `local/code-no-dangerous-type-assertions`; add `/* eslint-disable local/code-no-dangerous-type-assertions */` below the copyright header.

## Structure

- Group related tests with nested `suite()` calls, not comment headers like `// --- Section ---`.

## Sinon

Prefer events/state to verify behavior (e.g. await `TestCommandService.onWillExecuteCommand` instead of stubbing `executeCommand`). Use sinon when no observable signal exists.

## Async

- Await events with `Event.toPromise(event)` instead of timeouts.
- For debounce/throttle/scheduler logic, use `runWithFakedTimers`.
