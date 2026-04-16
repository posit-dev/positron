---
paths:
  - src/**/*.vitest.{ts,tsx}
  - vitest.config.ts
  - src/vs/test/vitest/**
---

# Vitest Tests

Vitest tests run directly on your source files -- no build daemons, no compilation step, no waiting. Just `npx vitest run <file>` and get results in seconds.

## Quick Start

### Testing a pure function?

1. Copy `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts`
2. Change the import to your function
3. Change the assertions
4. Run: `npx vitest run src/vs/path/to/yourTest.vitest.ts`

That's it. No builder, no services, no setup.

### Testing a React component?

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

- Place test files next to the source: `browser/` tests go in `test/browser/`, `common/` in `test/common/`. Match `test/` vs `tests/` per existing convention.
- File extension: `.vitest.ts` (or `.vitest.tsx` for React components)
- `/// <reference types="vitest/globals" />` after the copyright header (required for IDE intellisense)
- Tabs for indentation

## The Builder

Use `createTestContainer()` for any test needing services. Pick the lowest preset that covers your dependencies ([full preset hierarchy](../../src/vs/test/vitest/positronTestContainer.ts)). Start low and let errors guide you up:

1. Run the test. If it passes, you're done.
2. "X is not a function" or "Cannot read properties of undefined" -- add `.stub(IMissingService, {})`
3. A specific method is called -- stub just that method: `.stub(IService, { getDoc: () => undefined })`
4. Code subscribes to an event you don't need to fire -- use `Event.None`: `.stub(IService, { onDidChange: Event.None })`

**Event-driven behavior:** Create an `Emitter` at describe level, pass its `.event` to the stub, then call `.fire()` in your test (wrapped in `act()` for React components). See `webviewPlotThumbnail.vitest.tsx` and `startupStatus.vitest.tsx` in the working examples below.

**Common mistakes:** Don't destructure `ctx` at describe level (`const { instantiationService } = ...` captures `undefined` -- use `ctx.instantiationService` inside `it()` callbacks). Don't create emitters inside `it()` -- they must be at describe level so `.stub()` captures the right `.event` reference.

## Run commands

- `npm run test:vitest` -- run all
- `npx vitest run <file>` -- run one file
- `npx vitest run --coverage --coverage.include='**/sourceFile.tsx' <test-file>` -- scoped coverage
- `npx vitest run --update <file>` -- accept new inline snapshots

## Reference

**Mock utilities:** `vi.fn()` for stubs/spies, `vi.spyOn(obj, 'method')` to spy while preserving implementation, `Test*` classes / `mock.ts` for complex state (emitters, observable values).

**Inline snapshots:** Use `toMatchInlineSnapshot()` for rendered HTML. Vitest auto-fills on first run with `--update`. When a snapshot fails: read the diff, accept with `--update` if intentional, fix the source if it's a bug.

## Working examples

These showcase tests demonstrate the patterns at increasing complexity:
- `src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts` -- plain: pure function, no services, no builder
- `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx` -- React: one service, one click, behavioral assertions
- `src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx` -- event-driven intro: one emitter, act(), conditional rendering
- `src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx` -- event-driven advanced: 6-phase state machine, 3 event subscriptions
