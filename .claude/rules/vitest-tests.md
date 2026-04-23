---
paths:
  - src/**/*.vitest.{ts,tsx}
  - vitest.config.ts
  - src/vs/test/vitest/**
---

# Positron Vitest Tests

Vitest tests for Positron code (`*.vitest.ts` / `*.vitest.tsx` in `src/vs/`) run directly on your source files -- no build daemons, no compilation step, no waiting. Run `npx vitest <file>` for watch mode (re-runs on save) or `npx vitest run <file>` for a single pass.

## Quick Start

### Testing a pure function?

1. Copy `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts`
2. Change the import to your function
3. Change the assertions
4. Run: `npx vitest run src/vs/path/to/yourTest.vitest.ts`

That's it. No builder, no services, no setup.

### Testing a React component?

**Prop-driven or service-context?** Grep the component for `usePositronReactServicesContext`. If it appears anywhere in the file (or a child component rendered via context uses it), use service-context. When in doubt, use service-context -- it works for both.

1. Copy `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx`
2. Change these 4 things (everything else is boilerplate -- keep it):

```tsx
// (1) Your component import
import { MyComponent } from '../../browser/components/myComponent.js';
// (2) Your service import (only if you need to stub a service)
import { IMyService } from '...';

describe('MyComponent', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IMyService, { getData: vi.fn() })  // (3) Your stubs
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders', () => {
		rtl.render(<MyComponent />);              // (4) Your component + assertions
		// ... your assertions ...
	});
});
```

3. Run: `npx vitest run src/vs/path/to/yourTest.vitest.tsx`
4. If it fails with "missing service" errors, add more `.stub()` calls

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

## RTL idioms

For React component tests using `setupRTLRenderer()`:

**Query priority.** Prefer Testing Library queries in this order: `getByRole` -> `getByLabelText` -> `getByPlaceholderText` -> `getByText` -> `getByDisplayValue` -> `getByAltText` -> `getByTitle` -> `getByTestId`. Use `getByText('text', { selector: '.css' })` or `getByTestId(...)` when role/label aren't available -- add a brief inline comment if the choice isn't obvious.

**Assertions.** Use `@testing-library/jest-dom` matchers: `toBeInTheDocument`, `toHaveTextContent`, `toHaveClass`, `toBeDisabled`, `toBeVisible`, `toHaveAttribute`, etc. Prefer the dedicated matcher over manual property reads.

A bare `getByRole(...)` / `getByText(...)` / `getByAltText(...)` call is itself an assertion -- the query throws when the element isn't found. Don't wrap it in `expect(...).toBeInTheDocument()`; the wrapper adds nothing and can obscure the failure message. Reserve `toBeInTheDocument()` for `queryBy*` / `findBy*` returns where the value may be `null`.

See **Anti-patterns reference** below for the full table of patterns to avoid and their replacements.

## Anti-patterns reference

One-stop reference. Authors: scan before writing. Reviewers (and the `review-vitest-tests` skill): flag any "Avoid" pattern that isn't covered by the "Exception" column.

### Builder adoption (all `.vitest.*`)

| Avoid | Use instead | Exception |
|---|---|---|
| `positronWorkbenchInstantiationService()` | `createTestContainer().withWorkbenchServices().build()` | Inside shared test helpers invoked at test-runtime (inside `beforeEach` / `it`), where describe-scope `.build()` isn't viable |
| `TestInstantiationService` (the class) | Same | Used solely to bootstrap a test-helper service (e.g. `new TestCommandService(new TestInstantiationService())`) in `beforeEach`, not as a primary DI container |
| `workbenchInstantiationService()` (upstream helper) | Same | — |
| `createRuntimeServices()` | `createTestContainer().withRuntimeServices().build()` | — |
| Hand-rolled `as unknown as PositronReactServices` accessor | `createTestContainer().withReactServices().stub(IService, ...).build()` + `setupRTLRenderer(() => ctx.reactServices)` | — |
| `PositronReactServices.services = ...` singleton mutation | Same as above (plus drop save/restore in `beforeEach`/`afterEach`) | Source class reads the singleton directly in its constructor; a 1-line bridge `PositronReactServices.services = ctx.reactServices` with an inline comment is acceptable |

### RTL queries + matchers (`.vitest.tsx`)

| Avoid | Use instead | Exception |
|---|---|---|
| `container.querySelector(...)` as assertion target | Query by priority: `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` > `getByDisplayValue` > `getByAltText` > `getByTitle` > `getByTestId` | Structural element with no semantic handle: `expect(container.querySelector('.x')).toBeInTheDocument()` + inline comment explaining why no semantic query fits |
| `expect(el).toBeTruthy()` for DOM presence | bare `getBy*(...)` (the query IS the assertion) | — |
| `expect(el).toBeFalsy()` / `toBeNull()` for DOM absence | `expect(queryBy*(...)).not.toBeInTheDocument()` | — |
| `expect(getBy*(...)).toBeInTheDocument()` | bare `getBy*(...)` | Only the wrapped form is meaningful when the inner query is `queryBy*` / `findBy*` (may return `null`) |
| `assert.strictEqual(el.textContent, 'x')` | `expect(el).toHaveTextContent('x')` | — |
| `el.classList.contains('x')` | `expect(el).toHaveClass('x')` | — |
| `el.disabled === true` | `expect(el).toBeDisabled()` | — |
| `el.getAttribute('aria-x')` | `expect(el).toHaveAttribute('aria-x', '...')` | — |

### Assertion style (all `.vitest.*`)

| Avoid | Use instead |
|---|---|
| `assert.ok(x)` / `assert.equal(...)` / `assert.strictEqual(...)` | `expect(x).to*(...)` |

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

These showcase tests demonstrate the patterns at increasing complexity:
- [positronUpdateUtils](../../src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts) -- plain: pure function, no services, no builder
- [emptyConsole](../../src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx) -- React: one service, one click, behavioral assertions
- [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) -- event-driven intro: one emitter, act(), conditional rendering
- [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) -- event-driven advanced: 6-phase state machine, 3 event subscriptions
- [columnSummaryCell](../../src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx) -- RTL idioms: `getByText('text', { selector })` (query-as-assertion), no `querySelector`
