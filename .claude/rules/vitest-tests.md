---
paths:
  - src/**/*.vitest.{ts,tsx}
  - vitest.config.ts
  - src/vs/test/vitest/**
---

# Positron Vitest Tests

Vitest tests for Positron code (`*.vitest.ts` / `*.vitest.tsx` in `src/vs/`) run directly on your source files -- no build daemons, no compilation step, no waiting. Run `npx vitest <file>` for watch mode (re-runs on save) or `npx vitest run <file>` for a single pass.

> **Writing a React component test?** Also read [`vitest-rtl.md`](vitest-rtl.md) for query priority, jest-dom matcher selection, and RTL anti-patterns.

## Quick Start

### Testing a pure function

1. Copy `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts`
2. Change the import to your function
3. Change the assertions
4. Run: `npx vitest run src/vs/path/to/yourTest.vitest.ts`

That's it. No builder, no services, no setup.

### Testing a service or class with DI

Use the builder to wire test services. Pick the lowest preset that covers your dependencies (see `positronTestContainer.ts` JSDoc); start low and let "missing service" errors guide you up.

```ts
describe('MyService', () => {
    const ctx = createTestContainer()
        .withRuntimeServices()
        .stub(IMyService, { getData: vi.fn() })
        .build();

    it('does the thing', () => {
        const svc = ctx.instantiationService.createInstance(MyService);
        expect(svc.doThing()).toBe(true);
    });
});
```

## File setup

- Place test files next to the source: `browser/` tests go in `test/browser/`, `common/` in `test/common/`. Match `test/` vs `tests/` per existing convention. If no test directory exists yet, create the matching one.
- File extension: `.vitest.ts` (or `.vitest.tsx` for React components)
- `/// <reference types="vitest/globals" />` after the copyright header (required for IDE intellisense)
- Tabs for indentation

## The Builder

`createTestContainer()` is the builder -- a chained API (`.withX().stub().build()`) that wires up the DI services your test needs. Pick the lowest preset that covers your dependencies ([full preset hierarchy](../../src/vs/test/vitest/positronTestContainer.ts)). Start low and let errors guide you up:

1. Run the test. If it passes, you're done.
2. "X is not a function" or "Cannot read properties of undefined" -- add `.stub(IMissingService, {})`
3. A specific method is called -- stub just that method: `.stub(IService, { getDoc: () => undefined })`
4. Code subscribes to an event you don't need to fire -- use `Event.None`: `.stub(IService, { onDidChange: Event.None })`

**Event-driven behavior:** Create an `Emitter` at describe level, pass its `.event` to the stub, then call `.fire()` in your test (wrapped in `act()` for React components). See [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) (intro) and [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) (advanced).

**Common mistakes:**

- **Emitters inside `it()`.** Create them at describe level. `.stub()` captures the `.event` reference at describe scope during `build()`, so an emitter created later in `beforeEach` or `it()` is a different object and the stub won't fire.
- **`flushSync` to flush React state updates.** Use `act()` from `@testing-library/react` instead. `act()` wraps updates in React's testing envelope (no warnings) and drains the queue synchronously; `flushSync` forces a sync render but doesn't wrap, producing "An update to X was not wrapped in act(...)" messages.

## Builder anti-patterns

Positron-specific rules not covered by a public lint plugin. The `review-vitest-tests` skill scans for these; reviewers flag any "Avoid" match that isn't covered by "Exception."

| Avoid | Use instead | Exception |
|---|---|---|
| `positronWorkbenchInstantiationService()` | `createTestContainer().withWorkbenchServices().build()` | Inside shared test helpers invoked at test-runtime (inside `beforeEach` / `it`), where describe-scope `.build()` isn't viable |
| `TestInstantiationService` (the class) | Same | Used solely to bootstrap a test-helper service (e.g. `new TestCommandService(new TestInstantiationService())`) in `beforeEach`, not as a primary DI container |
| `workbenchInstantiationService()` (upstream helper) | Same | — |
| `createRuntimeServices()` | `createTestContainer().withRuntimeServices().build()` | — |
| Hand-rolled `as unknown as PositronReactServices` accessor | `createTestContainer().withReactServices().stub(IService, ...).build()` + `setupRTLRenderer(() => ctx.reactServices)` | — |
| `PositronReactServices.services = ...` singleton mutation | Same as above (plus drop save/restore in `beforeEach`/`afterEach`) | Source class reads the singleton directly in its constructor; a 1-line bridge `PositronReactServices.services = ctx.reactServices` with an inline comment is acceptable |

**Assertion style** (all `.vitest.*`): use `expect(x).to*(...)`, never `assert.ok` / `assert.equal` / `assert.strictEqual`.

**RTL-specific rules** are enforced by `eslint-plugin-testing-library` (see `eslint.config.js` for the list). Run `npx eslint <file>` to see violations; [`vitest-rtl.md`](vitest-rtl.md) documents each pattern.

## Run commands

- `npx vitest run` -- run all
- `npx vitest run <file>` -- run one file
- `npx vitest --watch <file>` -- watch mode (re-runs on save; press `q` to quit, `h` for keyboard help)
- `npx vitest run --coverage --coverage.include='**/sourceFile.tsx' <test-file>` -- scoped coverage
- `npx vitest run --update <file>` -- accept new inline snapshots

## Reference

**Mock utilities:** Prefer `vi.fn()` for new tests. Use `vi.spyOn(obj, 'method')` to spy while preserving the implementation. Reach for a `Test*` class or `mock.ts` only when the mock needs complex state (emitters, observable values) shared across multiple tests. `restoreMocks: true` and `clearMocks: true` are enabled globally in `vitest.config.ts`, so spies restore and call histories clear between tests automatically -- you don't need per-file `afterEach` cleanup.

**Disposables in plain tests:** The builder handles disposable-leak detection automatically via `createTestContainer().build()`. Plain tests that allocate disposables directly (without the builder) still need `ensureNoLeakedDisposables()` in `beforeEach` -- see [`src/vs/test/vitest/vitestUtils.ts`](../../src/vs/test/vitest/vitestUtils.ts).

**Inline snapshots:** Use `toMatchInlineSnapshot()` when you'd rather diff a known-good shape than maintain many separate assertions. Specifically: multi-property output (parser results, component markup), **exact-preservation** tests (round-trip fidelity, character-exact strings), **arrays of structured objects with 3+ entries**, **single objects projected to 3+ fields**, or when you'd otherwise write **3+ separate `.toBe()`/`.toEqual()` assertions against the same object** -- a known-good shape is easier to eyeball than a literal and survives field renames. Project structured objects to the relevant fields first: `expect({ kind, source, language }).toMatchInlineSnapshot(...)` beats snapshotting whole objects with irrelevant nested fields. For simple values, prefer `.toBe(...)`. Vitest fills and updates snapshots with `--update`; when one fails, read the diff before accepting.

## Working examples

- [positronUpdateUtils](../../src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts) -- plain: pure function, no services, no builder
- [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) -- event-driven intro: one emitter, `act()`, conditional rendering
- [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) -- event-driven advanced: 6-phase state machine, 3 event subscriptions

For more React/RTL-specific examples see [`vitest-rtl.md`](vitest-rtl.md).
