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

## Quick Start

Copy the EmptyConsole test and adapt it:

1. Copy `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx`
2. Change the component name and import
3. Change the `.stub()` to the service your component uses
4. Run: `npx vitest run src/vs/path/to/yourTest.vitest.tsx`
5. If it fails with "missing service" errors, add more `.stub()` calls

That's it. The builder and RTL renderer handle everything else. For advanced cases (presets, mocking philosophy, event testing), read on.

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

Place tests in the `test/browser/` directory adjacent to the source module. If no test directory exists, create `test/browser/`.

Examples:
- Source: `src/vs/workbench/contrib/positronConsole/browser/components/emptyConsole.tsx`
- Test: `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx`

Some modules use `tests/` (plural) -- match what already exists in that directory.

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

**Testing event-driven behavior:** Create an `Emitter` at describe level, pass its `.event` to the stub, then call `.fire()` in your test (wrapped in `act()` for React components):

```typescript
const onDidChange = new Emitter<string>();
const ctx = createTestContainer()
	.withRuntimeServices()
	.stub(IMyService, { onDidChange: onDidChange.event } as Partial<IMyService>)
	.build();

it('responds to event', () => {
	const instance = ctx.disposables.add(ctx.instantiationService.createInstance(MyClass));
	onDidChange.fire('new value');
	expect(instance.currentValue).toBe('new value');
});
```

**Why emitters must be at describe level:** The builder's `.stub()` captures the emitter's `.event` reference during `build()`, which runs at describe level before any `beforeEach`. If you create an `Emitter` inside `it()`, it's a different object than the one wired into the service -- your `.fire()` calls won't reach the component.

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

**RTL queries:** Use `getByRole` or `getByText` when the component exposes accessible roles or visible text. Many Positron components use internal CSS classes without accessible roles -- in that case, `container.querySelector` is the pragmatic choice. Don't force `getByRole` when the component doesn't support it.

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

**The `as Partial<IMyService>` cast:** Every `.stub()` call needs this cast. It's a TypeScript inference limitation, not a code smell. The builder's signature is `stub<T>(id, impl: Partial<T>)` but TS can't infer `T` from a partial object literal. This triggers `local/code-no-dangerous-type-assertions` warnings -- they're expected in test files.

## Common Mistakes

**Destructuring `ctx` at describe level:**
```typescript
// BUG: captures undefined -- instantiationService isn't set until beforeEach runs
const { instantiationService } = createTestContainer().build();

// CORRECT: access via ctx inside it() callbacks
const ctx = createTestContainer().build();
it('works', () => { ctx.instantiationService.createInstance(...); });
```
The builder uses lazy getters. `ctx.instantiationService` resolves at access time (inside `it()`). Destructuring at describe level evaluates the getter immediately, before `beforeEach` has run.

**Creating emitters inside `it()`:**
```typescript
// BUG: this emitter isn't the one wired into the service
it('responds', () => {
	const emitter = new Emitter<string>();  // wrong -- too late
	emitter.fire('value');  // nobody is listening
});

// CORRECT: emitter at describe level, .event passed to .stub()
const emitter = new Emitter<string>();
const ctx = createTestContainer().stub(IService, { onDidChange: emitter.event }).build();
```

**Using `ensureNoLeakedDisposables()` with the builder:**
```typescript
// WRONG: double-tracking -- the builder already calls this internally
const disposables = ensureNoLeakedDisposables();
const ctx = createTestContainer().build();

// CORRECT: just use the builder
const ctx = createTestContainer().build();
// ctx.disposables.add() if you need to track extra disposables
```

## Working examples

These showcase tests demonstrate the patterns at increasing complexity:
- `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx` -- simple: one service, one click
- `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx` -- medium: emitter-driven state, snapshots
- `src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx` -- complex: 6-phase state machine, 3 event subscriptions
