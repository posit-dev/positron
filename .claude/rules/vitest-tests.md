---
paths:
  - src/**/*.vitest.{ts,tsx}
  - extensions/**/*.vitest.{ts,tsx}
  - vitest.config.ts
  - vitest.tsconfig.json
  - src/vs/test/vitest/**
---

# Positron Vitest Tests

Vitest tests for Positron code (`*.vitest.ts` / `*.vitest.tsx`) run directly on your source files -- no build daemons, no compilation step, no waiting. Run `npx vitest <file>` for watch mode (re-runs on save) or `npx vitest run <file>` for a single pass.

Most live in `src/vs/`. Tests under `extensions/` are also collected, with extra setup -- see [Tests inside `extensions/`](#tests-inside-extensions).

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

### Tests inside `extensions/`

Vitest collects `extensions/**/*.vitest.{ts,tsx}` too. Four things differ from `src/vs/`.

**1. Exclude the tests from that extension's build, in the same change that adds the first one.** Add this to `extensions/<name>/tsconfig.json`:

```json
"exclude": [
	"src/**/*.vitest.ts",
	"src/**/*.vitest.tsx"
]
```

Without it, the test is compiled into `out/` and ships inside the extension, where its `vitest` import cannot resolve at runtime. Nothing else catches this: `compile-extension` runs tsgo straight off the extension's tsconfig and bypasses the gulp pipeline, `.vscodeignore` excludes `src/**` but not `out/**`, and the `.vitest.` filter in `build/lib/compilation.ts` applies only to the core `src` build. Each extension has to opt out for itself.

Confirm with a command, not by eye -- this fails silently:

```bash
npx tsc -p extensions/<name> --listFilesOnly | grep vitest   # expect no output
ls extensions/<name>/out | grep vitest                       # expect no output
```

Don't rely on a comment in `tsconfig.json` to explain the exclude. Those files get reformatted and the comments can be dropped; this section is the durable home for the reason.

**2. `vscode` is not a real package.** The extension host injects it at runtime, so nothing resolves it under Vitest. Importing it anywhere in the module graph fails the whole file before any test runs:

```
Failed to resolve import "vscode" from "<your test>". Does the file exist?
```

`vi.mock('vscode', () => ({ ... }))` does **not** fix this on its own -- resolution happens before mocking, so you get the identical error. Making it importable needs a `resolve.alias` in `vitest.config.ts` pointing `vscode` at a stub module. **No such alias exists today**, so as things stand a module that imports `vscode` cannot be unit tested here at all.

Prefer not to need one. Keep the logic worth testing in a plain module that imports nothing from `vscode`, and leave the configuration reads and API calls to its caller. `extensions/open-remote-ssh/src/serverDownloadUrl.ts` is the pattern: it declares a local interface for the one shape it needs instead of importing the `vscode` type, and its callers pass in the `inspect()` results. That seam is usually the better design anyway -- if a module can't be reached without `vscode`, the logic and the API access generally want separating.

Adding the alias is a shared-config change affecting every extension test, so agree on the stub's shape first rather than growing it ad hoc per test.

**3. To read files from the test, use `__dirname`.** `import.meta.url` reads better but does not survive the CommonJS type check in `vitest.tsconfig.json` (`TS1470`). `process.cwd()` is not the repo root: Vitest resolves `root` for module resolution but never changes the working directory, so a test using it passes from the repo root and fails from anywhere else.

**4. Type checking covers these files, but with core's compiler options.** `npm run test:positron:check-ts` picks them up through the `extensions/**/*.vitest.{ts,tsx}` entries in `vitest.tsconfig.json` -- both the test and any source it imports. Confirm with `npx tsc -p vitest.tsconfig.json --listFilesOnly | grep /extensions/`.

Those options come from `src/tsconfig.json`, not from the extension's own. The program checks at `strict: true, target: es2024`, while, for example, `positron-dev-containers` builds at `strict: false, target: es2018`. A green `check-ts` therefore does not prove the file would compile under the extension's tsconfig -- which is fine, because step 1 excludes it from that build on purpose. Just don't read it as coverage of the extension's real build settings.

Sharing code across extensions isn't possible (each compiles under its own tsconfig), so a helper needed by several is copied per extension. When that happens, add a guard that the copies stay identical -- see `extensions/serverDownloadUrl-copies.vitest.ts`.

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

- **Avoid private-method test-seams** (`as TypeWithPrivates` casts that reach into a class's private members to invoke them from a test). The test couples to internal structure — renaming or splitting the private method breaks the test even when behavior is unchanged. Two cleaner alternatives, depending on the source shape:
  - **Extract the private logic to a free exported function** the class calls. The class's closure or method becomes `() => extractedFunction(this.dep1, this.dep2)`. Tests import the function and call it directly.
  - **If the source is an anonymous class registered with `registerAction2(class extends ... {...})`**, promote it to a named exported class. Match the pattern of nearby named action classes (e.g. `selectionKeybindings.ts`'s `SelectUpAction` / `SelectDownAction`). The body stays identical; only the structural seam changes. Tests can then construct or import the action directly.

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

**Avoid snapshots when:**
- an explicit assertion would be clearer about what's actually being checked (a single value, a boolean condition)
- the output is large -- a snapshot that scrolls past a screen hides the one field that matters
- the output is unstable -- timestamps, generated ids, or ordering that isn't guaranteed will cause spurious diffs unrelated to the behavior under test
- only a few properties matter -- project to those fields (see above) rather than snapshotting the whole object as a substitute for picking the relevant assertions

A snapshot should make the test easier to read and maintain, not just be the fastest thing to generate.

## Working examples

- [positronUpdateUtils](../../src/vs/platform/update/test/common/positronUpdateUtils.vitest.ts) -- plain: pure function, no services, no builder
- [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) -- event-driven intro: one emitter, `act()`, conditional rendering
- [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) -- event-driven advanced: 6-phase state machine, 3 event subscriptions

For more React/RTL-specific examples see [`vitest-rtl.md`](vitest-rtl.md).
