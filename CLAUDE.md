# Positron Development Guidelines

Positron is a next-generation data science IDE built on VS Code with first-class Python and R support.

## Build System

**NEVER run direct TypeScript compilation** (`npx tsc`, `tsc --noEmit`, etc.). This project is too large and it will fail or hang. The background daemons handle all compilation. If you need to verify code compiles:

1. Check daemon status first: `npm run build-ps`
2. Start missing daemons in the background if needed: `npm run build-start`
3. Complete your task while the daemons compile in the background (30-60 seconds initial startup)
4. Check errors from the latest TypeScript compilation cycle: `npm run build-check`
	- Blocks until all daemons finish their current compilation cycle - do not `sleep` before it
	- Prints the errors for the last compilation cycle - call once and read the full output

Edge cases:

- Restart build daemons to fix missing package errors after `npm install`: `npm run build-stop && npm run build-start && npm run build-check`

## Upstream Compatibility

Positron forks VSCode. Minimize merge conflicts by isolating Positron code.

- Prefer new files over modifying upstream files
- Use `./scripts/file-origin.sh <file>` to check file origin
- When upstream edits are unavoidable, wrap changes:

	```typescript
	// --- Start Positron ---
	// Explanation of why this change is necessary
	// Commented out upstream code to aid merge conflict resolution
	// Keep changes minimal and contiguous
	...
	// --- End Positron ---
	```

## Testing

### Where should I put my test?

Two questions determine the test runner and pattern:

1. **Does it need Electron?** (activated extensions, workspace APIs, editor document manipulation)
2. **Is it a React component?** (a `.tsx` file that renders JSX)

| What you're testing | Runner | Pattern | Example |
|---|---|---|---|
| Pure function or class, no services | Vitest | **Plain test** -- import and call | `positronUpdateUtils.vitest.ts` |
| Service or class that needs DI services | Vitest | **Builder** -- `createTestContainer()` | `positronVariablesService.vitest.ts` |
| React component, props only | Vitest | **RTL prop-driven** -- `setupRTLRenderer()` | `reactTestingLibrary.vitest.tsx` |
| React component using `usePositronReactServicesContext()` | Vitest | **RTL service-context** -- `setupRTLRenderer(services)` | `topActionBarSessionManager.vitest.tsx` |
| Code needing activated extensions or workspace APIs | Mocha | **Extension host** -- `npm run test-extension` | |
| User-visible workflows across multiple systems | Playwright | **E2E** | |

**Plain test** -- no setup needed:
```typescript
it('builds URL with language params', () => {
	const result = buildUpdateUrl(baseUrl, ['python'], true, undefined);
	expect(result).toBe(`${baseUrl}?python=1`);
});
```

**Builder** -- handles disposable tracking and service setup automatically:
```typescript
const ctx = createTestContainer().withRuntimeServices().build();

it('starts a session', async () => {
	const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
	expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
});
```

**RTL prop-driven** -- component gets all data via props:
```typescript
const rtl = setupRTLRenderer();

it('renders the label', () => {
	rtl.render(<Label text="hello" />).getByText('hello');
});
```

**RTL service-context** -- component reads from context. The builder handles all service wiring:
```typescript
const ctx = createTestContainer()
	.withReactServices()
	.stub(IRuntimeSessionService, { foregroundSessionDisplayInfo: undefined, activeSessions: [], ... })
	.build();
const rtl = setupRTLRenderer(() => ctx.reactServices);

it('shows start session', () => {
	rtl.render(<TopActionBarSessionManager />).getByText('Start Session');
});
```

### Running tests

- **Vitest tests** (`*.vitest.ts` / `*.vitest.tsx`, **no build daemons needed**):
	- `npm run test:vitest`: run all Vitest tests
	- `npx vitest run src/path/to/<file>.vitest.ts`: run a specific file
	- `npx vitest run --reporter=verbose`: run with detailed output
	- `npx vitest run --coverage --coverage.include='**/myFile.tsx'`: run with scoped coverage
	- `npx vitest run --update <file>`: update inline snapshots
	- Vitest compiles TypeScript on-the-fly via esbuild -- no Electron, no `npm run build-start`, no wait. Ideal for rapid iteration and LLM-driven workflows.
- **Core tests** (`*.test.ts`, requires build daemons):
	- Ensure build daemons are running first: `npm run build-start && npm run build-check`
	- `./scripts/test.sh`: run all tests
	- `./scripts/test.sh --run src/path/to/<file>.test.ts`: run a specific file
	- `./scripts/test.sh --run src/path/to/<file>.test.ts --grep '<pattern>'`: run specific tests in a file
	- `./scripts/test.sh --runGlob <glob>.test.js`: run files matching a glob (use `.js` extension with `--runGlob`)
- **Extension tests** (`extensions/<extension-name>/*.test.ts`): `npm run test-extension -- -l <extension-name> --grep <pattern>`
	- positron-python has its own test setup -- see `extensions/positron-python/CLAUDE.md`
- **E2E tests** (full app, real browser): `npx playwright test test/e2e/tests/<test-name>.test.ts --project e2e-electron --grep '<pattern>'`

### The Builder

Use `createTestContainer()` for any test that needs services. Pick the lowest preset, use `.stub()` for extras. For pure logic tests, skip the builder entirely.

For presets, key rules, and the incremental mocking guide, see the JSDoc on `PositronTestContainerBuilder` in `src/vs/workbench/test/browser/positronTestContainer.ts`.

### React Component Testing (Vitest + RTL)

Two patterns for testing React components:

**Service-context pattern** -- for components that call `usePositronReactServicesContext()`.
Use `withReactServices()` and `ctx.reactServices` to bridge the builder with the React context:
```typescript
const ctx = createTestContainer()
	.withReactServices()
	.stub(IRuntimeSessionService, { foregroundSessionDisplayInfo: undefined, ... })
	.build();
const rtl = setupRTLRenderer(() => ctx.reactServices);

it('renders session info', () => {
	// getByText throws if not found -- the call itself is the assertion.
	rtl.render(<MyComponent />).getByText('Start Session');
});
```
The builder provides all 50+ services that `PositronReactServicesContext` needs.
Override specific services with `.stub()` -- child component dependencies are handled automatically.

**Prop-driven pattern** -- for components that receive all data via props:
```typescript
const rtl = setupRTLRenderer();

it('renders label', () => {
	// getByText throws if not found -- no expect() wrapper needed.
	rtl.render(<Label text="hello" />).getByText('hello');
});
```

**RTL query priority** (prefer top to bottom):
1. `getByRole` -- accessible roles (button, heading, etc.)
2. `getByText` -- visible text content
3. `getByLabelText` -- form labels
4. `getByTestId` -- last resort, `data-testid` attribute
5. `container.querySelector` -- escape hatch for CSS selectors

**Inline snapshots** -- use `toMatchInlineSnapshot()` to capture rendered HTML. Vitest auto-fills on first run with `--update`. Snapshots catch unintended UI regressions.

**When to use which mock utility:**
- `vi.fn()` -- simple function stubs/spies in Vitest tests. Prefer this for new tests.
- `vi.spyOn(obj, 'method')` -- spy on an existing method while preserving its implementation.
- Existing `mock.ts` / `Test*` classes -- use when the mock needs complex state (emitters, observable values, multi-method coordination). These exist for services like `TestRuntimeSessionService`.
- `sinon` -- avoid in new Vitest tests. Use `vi.fn()` instead.

## Directory Structure

- `src/` - Core VS Code source with Positron modifications
- `extensions/` - Built-in extensions including Positron-specific ones
- `test/e2e/` - End-to-end Playwright tests
- `positron/` - Positron-specific code and assets
- `build/` - Build configuration and scripts

## Code Style

- Use tabs for indentation in TypeScript/JavaScript, not spaces
- Never use em-dashes, en-dashes, smart quotes, or other non-ASCII punctuation. Use ASCII hyphens and straight quotes
- The pre-commit hook checks staged files for unicode, indentation, copyright headers, formatting, and eslint issues
- To run manually: `npm run precommit` (all staged files) or `npm run precommit -- <file>` (specific file)
- To auto-fix formatting issues in TypeScript/JavaScript files:
  - Formatting: `node scripts/format.mts <file> [file2] ...`
  - ESLint: `npx eslint --fix <file> [file2] ...`

## General

- Use the `gh` CLI for GitHub interactions
- Do not use unscoped search tools - they will search large compiled data and hang. Always use the builtin search tool
