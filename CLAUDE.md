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

Test at the **lowest layer** that can catch the bug:

1. **Vitest** (`*.vitest.ts`) -- DEFAULT for Positron code. Does your code import `vscode` or `positron`? If no, use Vitest. If yes but only for config/convenience, extract the logic and test it in Vitest.
2. **Extension host** (`npm run test-extension`) -- Only when your test genuinely needs VS Code/Positron extension APIs (extension activation, workspace APIs, editor documents).
3. **E2E** (Playwright) -- Only for user-visible workflows that span multiple systems.

Full strategy: `docs/superpowers/specs/2026-04-03-vitest-migration-design.md`

### Running tests

- Ensure build daemons are running before testing upstream or extension tests (NOT needed for Vitest)
- Core tests (`src/**/*.ts`):
	- `./scripts/test.sh`: run all tests
	- `./scripts/test.sh --run src/path/to/<file>.test.ts`: run a specific file
	- `./scripts/test.sh --run src/path/to/<file>.test.ts --grep '<pattern>'`: run specific tests in a file
	- `./scripts/test.sh --runGlob <glob>.test.js`: run files matching a glob (use `.js` extension with `--runGlob`)
- Positron Vitest tests (`src/**/*.vitest.ts`, no build daemon needed):
	- `npm run test-vitest`: watch mode (re-runs on save)
	- `npm run test-vitest:run`: single run
	- `npx vitest run src/path/to/<file>.vitest.ts`: run a specific file
	- `npx vitest run --grep '<pattern>'`: run tests matching a pattern
	- New Positron tests should use `.vitest.ts` extension -- see the tier guide below

### Positron Vitest Tiers

All Positron-specific tests use Vitest (`.vitest.ts`). Choose the tier that matches your test's needs:

**Tier 0 -- Pure Logic** (no DI, no disposables)

For testing pure functions, parsers, utilities, and data transformations. Import the module, call the function, assert the result. No service container, no disposable tracking needed.

```typescript
import { hasUpdate } from '../../common/positronVersion.js';

describe('positronVersion', () => {
	it('detects newer version', () => {
		expect(hasUpdate({ version: '2024.11.0' }, '2024.09.0')).toBe(true);
	});
});
```

**Tier 1 -- Light DI** (1-5 manual stubs)

For testing code that depends on a few services. Create a container, stub only what you need. Disposable tracking is handled automatically by the builder.

```typescript
import { createTestContainer } from '<path>/test/browser/positronTestContainer.js';
import { ILogService, NullLogService } from '<path>/platform/log/common/log.js';

describe('MyService', () => {
	const ctx = createTestContainer()
		.stub(ILogService, new NullLogService())
		.build();

	it('does the thing', () => {
		const service = ctx.instantiationService.createInstance(MyService);
		expect(service.doThing()).toBe(expected);
	});
});
```

**Tier 2 -- Runtime Services** (18 pre-configured stubs)

For testing code that interacts with language runtimes, sessions, or the console. The `.withRuntimeServices()` preset wires up ILanguageRuntimeService, IRuntimeSessionService, and 16 other services.

```typescript
import { createTestContainer } from '<path>/test/browser/positronTestContainer.js';
import { startTestLanguageRuntimeSession } from '<path>/runtimeSession/test/common/testRuntimeSessionService.js';

describe('MyRuntimeFeature', () => {
	const ctx = createTestContainer().withRuntimeServices().build();

	it('starts a session', async () => {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		expect(session).toBeDefined();
	});
});
```

**Tier 3 -- Full Workbench** (124+ pre-configured stubs)

For testing code that needs the full Positron workbench (notebooks, plots, variables, webviews, etc.). The `.withWorkbenchServices()` preset includes everything from Tier 2 plus notebook services, editor services, and all Positron-specific services.

```typescript
import { createTestContainer } from '<path>/test/browser/positronTestContainer.js';
import { IPositronVariablesService } from '<path>/positronVariables/common/interfaces/positronVariablesService.js';

describe('MyWorkbenchFeature', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();
	let variablesService: IPositronVariablesService;

	beforeEach(() => {
		variablesService = ctx.get(IPositronVariablesService);
	});

	it('initializes empty', () => {
		expect(variablesService.activePositronVariablesInstance).toBeUndefined();
	});
});
```

**Key rules across all tiers:**
- Use the lowest tier that works -- simpler tests are easier to maintain and faster to run
- The builder result (`ctx`) uses lazy getters -- access `ctx.instantiationService` inside `beforeEach`/`it`, not at describe-level via destructuring
- `ctx.disposables` is auto-cleaned after each test -- pass it to helpers like `startTestLanguageRuntimeSession()` that need it
- Override any preset service with `.stub(IService, mock)` after a preset call
- Upstream VS Code tests stay on Mocha (`.test.ts`) -- only Positron tests use Vitest

### How to mock (the incremental approach)

You don't need to understand all 124 services. You build mocks incrementally -- start with nothing and let the test tell you what's missing.

**Step 1: Start with a tier preset and run the test.**

```typescript
const ctx = createTestContainer().withRuntimeServices().build();
```

If the test passes, you're done. Most dependencies are already handled.

**Step 2: If it fails with "X is not a function" or "Cannot read properties of undefined", a service is missing.**

Add an empty stub for just that service:

```typescript
const ctx = createTestContainer()
	.withRuntimeServices()
	.stub(IMissingService, {} as IMissingService)
	.build();
```

Run again. If it passes, you're done. The empty stub works when the code has the dependency but your test path doesn't call it.

**Step 3: If it still fails because the code calls a specific method, add just that method.**

```typescript
.stub(IMissingService, {
	getDoc: () => undefined,
} as IMissingService)
```

**Step 4: If the code listens to an event, add an Emitter.**

```typescript
import { Emitter } from '<path>/base/common/event.js';

const onDidChange = new Emitter<void>();
.stub(IMissingService, {
	getDoc: () => undefined,
	onDidChange: onDidChange.event,
} as IMissingService)
```

Now your test can trigger the event with `onDidChange.fire()` to test reactive behavior.

**The pattern: empty -> add methods -> add events.** You never mock more than what the test actually needs. If you're writing 20 lines of mock setup, you're probably over-mocking -- step back and check if a higher tier preset already covers it.
- Extension tests (`extensions/<extension-name>/*.test.ts`, preferred for extension development except positron-python): `npm run test-extension -- -l <extension-name> --grep <pattern>`
	- For positron-python, see that extension's CLAUDE.md
- E2E tests (for UI integration testing): `npx playwright test test/e2e/tests/<test-name>.test.ts --project e2e-electron --grep '<pattern>'`

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
