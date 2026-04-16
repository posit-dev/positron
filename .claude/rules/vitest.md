---
paths:
  - src/**/*.vitest.{ts,tsx}
  - vitest.config.ts
  - src/vs/test/vitest/**
---

# Vitest Tests

Vitest tests run directly on your source files -- no build daemons, no compilation step, no waiting. Just `npx vitest run <file>` and get results in seconds.

## Quick Start

**Testing a pure function?** Copy the simplest test and adapt it:

1. Copy `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts`
2. Change the import to your function
3. Change the assertions
4. Run: `npx vitest run src/vs/path/to/yourTest.vitest.ts`

That's it. No builder, no services, no setup.

**Testing a React component?** Copy the EmptyConsole test and change 4 things:

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

## Run commands

- `npm run test:vitest` -- run all
- `npx vitest run <file>` -- run one file
- `npx vitest run --coverage --coverage.include='**/sourceFile.tsx' <test-file>` -- scoped coverage
- `npx vitest run --update <file>` -- accept new inline snapshots

## Conventions

- `/// <reference types="vitest/globals" />` after the copyright header (required for IDE intellisense -- vitest runs fine without it, but editors won't autocomplete `describe`, `it`, `expect` etc.)
- Vitest syntax: `describe()`, `it()`, `beforeEach()`, `afterEach()`, `expect()`
- File extension: `.vitest.ts` (or `.vitest.tsx` for React components)
- Tabs for indentation

## Where to put the test file

Mirror the source file's subdirectory under `test/`. If the source is in `browser/`, the test goes in `test/browser/`. If the source is in `common/`, the test goes in `test/common/`. If no test directory exists, create the matching one.

Examples:
- Source: `src/vs/workbench/contrib/positronConsole/browser/components/emptyConsole.tsx`
- Test: `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx`
- Source: `src/vs/platform/update/common/positronUpdateUtils.ts`
- Test: `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts`

Some modules use `tests/` (plural) -- match what already exists in that directory.

## The Builder

Use `createTestContainer()` for any test needing services. The builder handles `ensureNoLeakedDisposables()` automatically -- do NOT add it yourself.

**Do I need `ensureNoLeakedDisposables()`?** Only if your test creates disposables directly (via `new`). Pure function tests don't need it. When in doubt, leave it out -- the builder adds it automatically, and plain tests that don't create disposables have nothing to leak.

Pick the lowest preset that covers your test's dependencies. Presets form a hierarchy (each includes the one above) -- see the full list and when to add new ones in the [PositronTestContainerBuilder JSDoc](../../src/vs/test/vitest/positronTestContainer.ts). Start low and let errors guide you up.

**Don't guess -- iterate.** Start with a preset and run the test. If it passes, you're done. If it fails with "X is not a function" or "Cannot read properties of undefined," add `.stub(IMissingService, {})`. Add only the method the error names: `.stub(IService, { getDoc: () => undefined })`. For events the test doesn't fire, use `Event.None`: `.stub(IService, { onDidChange: Event.None })`.

**Testing event-driven behavior:** Create an `Emitter` at describe level, pass its `.event` to the stub, then call `.fire()` in your test (wrapped in `act()` for React components). See `webviewPlotThumbnail.vitest.tsx` and `startupStatus.vitest.tsx` in the working examples below.

## React Component Testing (RTL)

The quick start above shows the service-context pattern (most Positron components). For **prop-driven components** (no `usePositronReactServicesContext()`), skip the builder -- call `setupRTLRenderer()` with no arguments and render directly.

**RTL queries:** Use `getByRole` or `getByText` when the component exposes accessible roles or visible text. Many Positron components use internal CSS classes without accessible roles -- in that case, `container.querySelector` is the pragmatic choice.

## Inline Snapshots

Use `toMatchInlineSnapshot()` to capture rendered HTML. Vitest auto-fills on first run with `--update`. When a snapshot fails:
1. Read the diff -- is the change intentional (upstream refactor) or a bug?
2. If intentional: `npx vitest run --update <file>` to accept the new output, then commit
3. If a bug: fix the source code, not the snapshot

## Mock Utilities

- `vi.fn()` -- simple stubs/spies. Prefer this for new Vitest tests.
- `vi.spyOn(obj, 'method')` -- spy on existing method while preserving implementation.
- `Test*` classes / `mock.ts` -- complex state (emitters, observable values). Use when multiple tests need the same mock behavior.

## Common Mistakes

**Destructuring `ctx` at describe level:** `const { instantiationService } = createTestContainer().build()` captures `undefined` because the builder uses lazy getters. Always access via `ctx.instantiationService` inside `it()` callbacks.

**Creating emitters inside `it()`:** An emitter created inside `it()` is a different object than the one `.stub()` captured at describe level -- `.fire()` calls won't reach the component. Always create emitters at describe level.

## Working examples

These showcase tests demonstrate the patterns at increasing complexity:
- `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts` -- plain: pure function, no services, no builder
- `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx` -- React: one service, one click, behavioral assertions
- `src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx` -- event-driven intro: one emitter, act(), conditional rendering
- `src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx` -- event-driven advanced: 6-phase state machine, 3 event subscriptions
