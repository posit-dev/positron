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

The deciding question: **does it need Electron?**

1. **Core tests** (`*.test.ts`) -- DEFAULT for Positron code in `src/`. No Electron needed. Covers everything from pure functions to 124-service integration tests. If your code doesn't genuinely need `vscode`/`positron` APIs at runtime, it belongs here.
2. **Extension host** (`npm run test-extension`) -- Needs Electron. Only when your test requires activated extensions, workspace APIs, or editor document manipulation.
3. **E2E** (Playwright) -- Needs the full app. Only for user-visible workflows across multiple systems.

### Running tests

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

The builder (`createTestContainer()`) provides presets for common service groupings. Pick the lowest one that works, and use `.stub()` to add or override individual services.

For pure logic tests (no services), skip the builder entirely -- just import and assert.

For available presets and examples, see `src/vs/workbench/test/browser/positronTestContainer.ts`.

**Key rules:**
- Any preset supports `.stub(IService, mock)` for adding or overriding individual services
- The builder result (`ctx`) uses lazy getters -- access `ctx.instantiationService` inside `setup`/`test`, not at suite-level via destructuring
- `ctx.disposables` is auto-cleaned after each test -- pass it to helpers like `startTestLanguageRuntimeSession()` that need it

**When to add a new preset vs using .stub():**
- **Use .stub()** when 1-2 test files need extra services, or the stubs are simple (`{} as T`)
- **Add a preset** when 3+ test files across different directories need the same non-trivial stub set (emitters, real instances) and the services map to a recognizable domain (e.g. "Quarto", "Plots")

### How to mock (the incremental approach)

You don't need to understand all 124 services. You build mocks incrementally -- start with nothing and let the test tell you what's missing.

**Step 1: Start with a preset and run the test.**

```typescript
const ctx = createTestContainer().withRuntimeServices().build();
```

If the test passes, you're done. Most dependencies are already handled.

**When NOT to create a Test* class:** The presets use existing Test* classes internally, but you don't need to create new ones. A `.stub(IService, { methodYouNeed: () => value })` is almost always sufficient. Only create a dedicated Test* class if multiple test files need the same complex mock with emitters, state tracking, or multi-method behavior.

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

**The pattern: empty -> add methods -> add events.** You never mock more than what the test actually needs. If you're writing 20 lines of mock setup, you're probably over-mocking -- step back and check if a higher preset already covers it.

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
