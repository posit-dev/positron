# Positron Development Guidelines

Positron is a next-generation data science IDE built on VS Code with first-class Python and R support.

## Build System

**NEVER run direct TypeScript compilation on the main project** (`npx tsc`, `tsc --noEmit`, etc. against `src/tsconfig.json`). This project is too large and it will fail or hang. The background daemons handle all compilation. If you need to verify code compiles:

1. Check daemon status first: `npm run build-ps`
2. Start missing daemons in the background if needed: `npm run build-start`
3. Complete your task while the daemons compile in the background (30-60 seconds initial startup)
4. Check errors from the latest TypeScript compilation cycle: `npm run build-check`
	- Blocks until all daemons finish their current compilation cycle - do not `sleep` before it
	- Prints the errors for the last compilation cycle - call once and read the full output

Edge cases:

- Restart build daemons to fix missing package errors after `npm install`: `npm run build-stop && npm run build-start && npm run build-check`

**Exception for vitest test files:** `npm run build-check` excludes `*.vitest.ts` files, so it won't surface type errors in tests. To check those, run `npm run test:positron:check-ts` (wraps `tsc --noEmit -p ./vitest.tsconfig.json --skipLibCheck`). It is scoped to vitest files + their ambient declarations and completes in seconds. The output matches what the VS Code Problems pane shows for `.vitest.{ts,tsx}` files. Filter to a specific file with: `npm run test:positron:check-ts 2>&1 | grep '<file>.vitest.ts'`.

### Reproducing CI Failures Locally (Posit-internal)

Only when the user explicitly asks to reproduce a CI-only failure on the real CI
image (arm64). Requires private GHCR access + license files (not for external
contributors) -- gate on `gh api repos/posit-dev/positron-ci-images` (404 = no
access; tell the user, don't attempt setup).

Then read *all* of `.devcontainer/ci-arm/README.md` before acting -- not just its
"Claude Workflows" section, whose commands depend on Setup/Gotchas context from the
rest of the file. It covers reusing the long-lived lab worktree (don't recreate it)
and repointing it at a new branch.

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

- **Unit tests**: exercise modules in isolation. Two runners:
	- **[Positron Vitest](.claude/rules/vitest-tests.md)**: fast, no build daemons. Use this for new Positron code.
	- **[Core Mocha](.claude/rules/core-tests.md)**: upstream VS Code's suite. Slower, needs build daemons. You'll encounter it when touching upstream files; don't start new ones for Positron code.
- **[Extension host tests](test/integration/browser/README.md)**: Mocha tests that need an activated extension host. Historical VS Code docs call these "integration tests"; same thing. Two categories:
	- **API contract tests**: `extensions/vscode-api-tests/` regressions against the `vscode` API surface.
	- **Extension-internal tests**: each extension tests its own features (e.g., `positron-python`, `positron-r`, `git`, `typescript-language-features`).
- **[E2E tests](test/e2e/README.md)**: Playwright, exercises the whole app.

### Where should I put my test?

**Test at the lowest level that covers the behavior.** A unit test that runs in milliseconds is better than an E2E test that takes seconds and can flake. Reserve E2E for workflows that genuinely need the full app.

| What you're testing | Runner | Scope / Path | Pattern | File extension |
|---|---|---|---|---|
| Pure function or class, no services | Vitest | `src/vs/**` | **Plain test** | `.vitest.ts` |
| Service or class that needs DI services | Vitest | `src/vs/**` | **Builder** <br> `createTestContainer()` | `.vitest.ts` |
| React component, props only | Vitest | `src/vs/**` | **RTL prop-driven** <br> `setupRTLRenderer()` | `.vitest.tsx` |
| React component using services | Vitest | `src/vs/**` | **RTL service-context** <br> `withReactServices()` | `.vitest.tsx` |
| Existing upstream VS Code test (rare) | Mocha (Electron/Node/Browser) | `src/vs/**/test/` | **Match existing** <br> `Mocha suite()/test()` | `.test.ts` / `.integrationTest.ts` |
| Code needing activated extensions or workspace APIs | Mocha (ext host) | `extensions/<name>/` | **vscode API** <br> `import * as vscode` | `.test.ts` |
| User-visible workflows across multiple systems | Playwright | `test/e2e/` | **Page Object Model** <br> `app.workbench.*` | `.test.ts` |

**Don't create new `.test.ts` in `src/vs/` for Positron code** -- use Vitest. Core Mocha rows are for maintaining existing upstream tests.

### Running tests

- **Vitest** (`*.vitest.ts` / `*.vitest.tsx`, **no build daemons needed**):
	- `npm run test:positron`: run all
	- `npx vitest run src/path/to/<file>.vitest.ts`: run a specific file
	- `npx vitest --watch src/path/to/<file>.vitest.ts`: watch mode (re-runs on save; press `q` to quit, `h` for keyboard help)
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
- When registering user-facing configuration, follow the **[guidance on settings](.claude/rules/configuration.md)**. Setting keys, titles, and display names omit redundant terms ("Positron", "Setting", etc.); `localize()` IDs keep the `positron.` prefix.
- When adding AI-related functionality (anything that calls a model, suggests completions, or surfaces AI actions), gate it on the `ai.enabled` main switch -- see **[AI feature gating](.claude/rules/ai-gating.md)**.

## General

- Use the `gh` CLI for GitHub interactions
- Do not use unscoped search tools - they will search large compiled data and hang. Always use the builtin search tool
