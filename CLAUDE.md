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

### Terminology

Positron has three test categories:

- **Unit tests** -- exercise modules in isolation. Two runners:
	- **Vitest** -- fast, no build daemons. Use this for new Positron code.
	- **Core Mocha** -- upstream VS Code's suite. Slower, needs build daemons. You'll encounter it when touching upstream files; don't start new ones for Positron code.
- **Extension host tests** -- Mocha tests that need an activated extension host. Historical VS Code docs call these "integration tests"; same thing.
- **E2E tests** -- Playwright, exercises the whole app.

### Where should I put my test?

| What you're testing | Runner | Scope / Path | Pattern | File extension |
|---|---|---|---|---|
| Pure function or class, no services | Vitest | `src/vs/**` | **Plain test** | `.vitest.ts` |
| Service or class that needs DI services | Vitest | `src/vs/**` | **Builder** -- `createTestContainer()` | `.vitest.ts` |
| React component, props only | Vitest | `src/vs/**` | **RTL prop-driven** -- `setupRTLRenderer()` | `.vitest.tsx` |
| React component using services | Vitest | `src/vs/**` | **RTL service-context** -- `withReactServices()` | `.vitest.tsx` |
| Existing upstream VS Code test (rare) | Mocha (Electron/Node/Browser) | `src/vs/**/test/` | **Core Mocha** -- `./scripts/test.sh` | `.test.ts` / `.integrationTest.ts` |
| Code needing activated extensions or workspace APIs | Mocha (ext host) | `extensions/<name>/` | **Extension host** -- `npm run test-extension` | `.test.ts` |
| User-visible workflows across multiple systems | Playwright | `test/e2e/` | **E2E** | `.test.ts` |

**Don't create new `.test.ts` in `src/vs/` for Positron code** -- use Vitest. Core Mocha rows are for maintaining existing upstream tests.

### Running tests

- **Vitest** (`*.vitest.ts` / `*.vitest.tsx`, **no build daemons needed**):
	- `npm run test:vitest`: run all
	- `npx vitest run src/path/to/<file>.vitest.ts`: run a specific file
	- `npx vitest run --coverage --coverage.include='**/myFile.tsx' <test-file>`: scoped coverage
	- `npx vitest run --update <file>`: update inline snapshots
- **Core Mocha** (`*.test.ts` / `*.integrationTest.ts` in `src/vs/`, requires build daemons):
	- Ensure build daemons are running first: `npm run build-start && npm run build-check`
	- `npm run test:core` (or `./scripts/test.sh`): run all
	- `./scripts/test.sh --run src/path/to/<file>.test.ts`: run a specific file
	- `./scripts/test.sh --runGlob <glob>.test.js`: run files matching a glob (use `.js` extension)
- **Extension host** (`extensions/<extension-name>/*.test.ts`):
	- `npm run test-extension -- -l <extension-name> --grep <pattern>`: run one extension's tests
	- `npm run test:ext-host` (or `./scripts/test-integration.sh`): run the full CI driver
	- positron-python has its own test setup -- see `extensions/positron-python/CLAUDE.md`
- **E2E** (Playwright, full app): `npx playwright test test/e2e/tests/<test-name>.test.ts --project e2e-electron --grep '<pattern>'`

**Writing your first Vitest test?** See the quick start, code examples, and common mistakes in [`.claude/rules/vitest.md`](.claude/rules/vitest.md) -- it's the complete testing guide for both humans and Claude.

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
