# Positron Development Guidelines

Positron is a next-generation data science IDE built on VS Code with first-class Python and R support.

## Build System

**NEVER run direct TypeScript compilation** (`npx tsc`, `tsc --noEmit`, etc.). This project is too large and it will fail or hang. The background daemons handle all compilation. If you need to verify code compiles:

1. Check daemon status first: `npm run build-ps`
2. Start missing daemons in the background if needed: `npm run build-start`
3. Complete your task while the daemons compile in the background (30-60 seconds initial startup)
4. Check errors from the latest TypeScript compilation cycle. **ALWAYS use this to check TypeScript compilation status**: `npm run build-check`

Edge cases:

- Restart build daemons to fix missing package errors after `npm install`: `npm run build-stop && npm run build-start && sleep 60 && npm run build-check`

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

- Ensure build daemons are running before testing
- Extension tests (preferred for extension development): `npm run test-extension -- -l <extension-name> --grep <pattern>`
- E2E tests (for UI integration testing): `npx playwright test test/e2e/tests/<test-name>.test.ts --project e2e-electron --reporter list --grep '<pattern>'`
- Core tests (for core IDE unit/integration testing): `./scripts/test.sh --grep <pattern> --run <file>`

## Directory Structure

- `src/` - Core VS Code source with Positron modifications
- `extensions/` - Built-in extensions including Positron-specific ones
- `test/e2e/` - End-to-end Playwright tests
- `positron/` - Positron-specific code and assets
- `build/` - Build configuration and scripts

## General

- Use the `gh` CLI for GitHub interactions
