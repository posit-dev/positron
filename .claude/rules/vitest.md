---
paths:
  - src/**/*.vitest.{ts,tsx}
  - vitest.config.ts
  - src/vs/base/test/browser/reactTestingLibrary.tsx
  - src/vs/base/test/common/vitestUtils.ts
  - src/vs/workbench/test/browser/positronTestContainer.ts
---

# Vitest Tests

Positron Vitest tests (`*.vitest.ts` / `*.vitest.tsx`) run via `npx vitest run` with no Electron or build daemons.

## Run commands

- `npm run test:vitest` -- run all
- `npx vitest run <file>` -- run one file
- `npx vitest run --coverage --coverage.include='**/sourceFile.tsx' <test-file>` -- scoped coverage
- `npx vitest run --update <file>` -- accept new inline snapshots

## Conventions

- `/// <reference types="vitest/globals" />` after the copyright header
- Vitest syntax: `describe()`, `it()`, `beforeEach()`, `afterEach()`, `expect()`
- File extension: `.vitest.ts` (or `.vitest.tsx` for React components)
- Tabs for indentation

## The Builder

Use `createTestContainer()` for any test needing services. The builder handles `ensureNoLeakedDisposables()` automatically -- do NOT add it yourself.

```typescript
const ctx = createTestContainer().withRuntimeServices().build();

it('starts a session', async () => {
	const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
	expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
});
```

For presets, mocking guide, and key rules, see the JSDoc on `PositronTestContainerBuilder` in `src/vs/workbench/test/browser/positronTestContainer.ts`.

## React Component Testing (RTL)

`setupRTLRenderer()` wraps components in the full Positron provider tree automatically. No manual provider wrapping needed.

**Service-context pattern** -- component calls `usePositronReactServicesContext()`. Use `withReactServices()` to bridge builder services into the React context:

```typescript
const ctx = createTestContainer()
	.withReactServices()
	.stub(IRuntimeSessionService, { foregroundSessionDisplayInfo: undefined, ... })
	.build();
const rtl = setupRTLRenderer(() => ctx.reactServices);

it('renders session info', () => {
	rtl.render(<MyComponent />).getByText('Start Session');
});
```

The builder provides all 50+ services that `PositronReactServicesContext` needs. Override specific services with `.stub()` -- child component dependencies are handled automatically.

**Prop-driven pattern** -- component gets all data via props:

```typescript
const rtl = setupRTLRenderer();

it('renders label', () => {
	rtl.render(<Label text="hello" />).getByText('hello');
});
```

**RTL query priority** (prefer top to bottom):
1. `getByRole` -- accessible roles (button, heading, etc.)
2. `getByText` -- visible text content
3. `getByLabelText` -- form labels
4. `getByTestId` -- last resort, `data-testid` attribute
5. `container.querySelector` -- escape hatch for CSS selectors

## Inline Snapshots

Use `toMatchInlineSnapshot()` to capture rendered HTML. Vitest auto-fills on first run with `--update`. When a snapshot fails:
1. Read the diff -- is the change intentional (upstream refactor) or a bug?
2. If intentional: `npx vitest run --update <file>` to accept the new output, then commit
3. If a bug: fix the source code, not the snapshot

## Mock Utilities

- `vi.fn()` -- simple stubs/spies. Prefer this for new Vitest tests.
- `vi.spyOn(obj, 'method')` -- spy on existing method while preserving implementation.
- `Test*` classes / `mock.ts` -- complex state (emitters, observable values). Use when multiple tests need the same mock behavior.
- `sinon` -- avoid in new Vitest tests.
