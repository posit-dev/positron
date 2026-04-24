# Positron Vitest Tests

Vitest tests for Positron code (`*.vitest.ts` / `*.vitest.tsx` in `src/vs/`) run directly on your source files -- no build daemons, no compilation step, no waiting. Run `npx vitest <file>` for watch mode (re-runs on save) or `npx vitest run <file>` for a single pass.

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

### Testing a React component

Read [`vitest-rtl.md`](vitest-rtl.md) for query priority, jest-dom matcher selection, and RTL anti-patterns. That file has the React Quick Start and the full RTL convention set.

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

- **Avoid `positronWorkbenchInstantiationService()`** -- use `createTestContainer().withWorkbenchServices().build()`.
  *Exception:* inside shared test helpers invoked at test-runtime (inside `beforeEach` / `it`), where describe-scope `.build()` isn't viable.

- **Avoid `TestInstantiationService`** (the class) -- use `createTestContainer().with<preset>().build()`. Pick the lowest preset that covers your services (see `positronTestContainer.ts` JSDoc).
  *Exception:* used solely to bootstrap a test-helper service (e.g. `new TestCommandService(new TestInstantiationService())`) in `beforeEach`, not as a primary DI container.

- **Avoid `workbenchInstantiationService()`** (upstream VS Code helper) -- use `createTestContainer().withWorkbenchServices().build()`.

- **Avoid `createRuntimeServices()`** -- use `createTestContainer().withRuntimeServices().build()`.

- **Avoid hand-rolled `as unknown as PositronReactServices` accessor** -- use `createTestContainer().withReactServices().stub(IService, ...).build()` + `setupRTLRenderer(() => ctx.reactServices)`.

- **Avoid `{...} as unknown as <Interface>` for wide-interface partial stubs.** Use `stubInterface<T>(overrides)` from [`src/vs/test/vitest/stubInterface.ts`](../../src/vs/test/vitest/stubInterface.ts) instead: `const foo = stubInterface<IFoo>({ bar: ... });`. Unset reads throw with a clear message (instead of silently returning `undefined` through a cast) and the overrides stay typed against the real interface. See the helper's JSDoc for examples. When a purpose-built no-op already exists (e.g. `NullLogService` from `platform/log/common/log.js`, `Test*` classes under `workbench/test/**`), prefer that over `stubInterface`. For *named* test classes with constructors and internal state, the upstream `mock<T>()` helper (`src/vs/base/test/common/mock.ts`) remains the right tool.
  *Exception:* narrowing casts where the runtime value really is the target type -- `ctx.get(IService) as TestService`, `screen.getByRole('textbox') as HTMLInputElement`, `delegate.getActions() as IAction[]`. These are not wide-interface stubs; they're telling the compiler about a value we already have.

- **Avoid `PositronReactServices.services = ...` singleton mutation** -- use `createTestContainer().withReactServices().stub(...).build()` and drop the `beforeEach`/`afterEach` save/restore dance.
  *Exception:* source class reads the singleton directly in its constructor; a 1-line bridge `PositronReactServices.services = ctx.reactServices` with an inline comment is acceptable.

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

**Module-level mocking (`vi.mock`):** reach for this when a function's real implementation pulls in heavy transitive deps (AMD loads, large rendering pipelines, filesystem access) and your test only cares about the function's return shape. Mocking one module is cleaner than deep-stubbing its chain of dependencies. Use `vi.hoisted` to share the mock `vi.fn()` with the test body (`vi.mock` is hoisted above imports, so a top-level `vi.fn()` hits TDZ otherwise):

```tsx
const { mockRender } = vi.hoisted(() => ({ mockRender: vi.fn() }));
vi.mock('../path/to/module.js', () => ({ renderFoo: mockRender }));
```

Prefer `.stub()` via the builder for DI services -- `vi.mock` is the escape hatch for module-level things outside the container.

**Disposables in plain tests:** The builder handles disposable-leak detection automatically via `createTestContainer().build()`. Plain tests that allocate disposables directly (without the builder) still need `ensureNoLeakedDisposables()` in `beforeEach` -- see [`src/vs/test/vitest/vitestUtils.ts`](../../src/vs/test/vitest/vitestUtils.ts).

**Inline snapshots:** Use `toMatchInlineSnapshot()` when you'd rather diff a known-good shape than maintain many separate assertions. Specifically: multi-property output (parser results, component markup), **exact-preservation** tests (round-trip fidelity, character-exact strings), **arrays of structured objects with 3+ entries**, **single objects projected to 3+ fields**, or when you'd otherwise write **3+ separate `.toBe()`/`.toEqual()` assertions against the same object** -- a known-good shape is easier to eyeball than a literal and survives field renames. Project structured objects to the relevant fields first: `expect({ kind, source, language }).toMatchInlineSnapshot(...)` beats snapshotting whole objects with irrelevant nested fields. For simple values, prefer `.toBe(...)`. Vitest fills and updates snapshots with `--update`; when one fails, read the diff before accepting.

## Working examples

- [positronUpdateUtils](../../src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts) -- plain: pure function, no services, no builder
- [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) -- event-driven intro: one emitter, `act()`, conditional rendering
- [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) -- event-driven advanced: 6-phase state machine, 3 event subscriptions

For more React/RTL-specific examples see [`vitest-rtl.md`](vitest-rtl.md).
