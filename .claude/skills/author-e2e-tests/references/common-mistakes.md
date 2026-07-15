# Common Mistakes and Gotchas

This file focuses on Positron-specific mistakes when writing e2e tests:

## Critical Mistakes

### 1. Wrong Import Source

**WRONG:**
```typescript
import { test, expect } from '@playwright/test';
```

**CORRECT:**
```typescript
import { test, expect, tags } from '../_test.setup';
```

The custom `_test.setup` provides all Positron fixtures. Using the raw Playwright import will cause fixture errors.

### 2. Missing suiteId

Every test file must start with `test.use({ suiteId: __filename })`. Without it, tests may share app instances incorrectly, logs won't be organized by test file, and `beforeAll`/`afterAll` won't work as expected.

```typescript
test.use({
	suiteId: __filename
});

test.describe('Console Tests', () => {
	test('my test', async ({ app }) => {
		// ...
	});
});
```

### 3. Forgetting Tags for Cross-Platform Tests

Without platform tags, a test only runs on Linux/Electron -- add `tags.WEB` to also run in web browser mode, `tags.WIN` for Windows.

```typescript
test.describe('Console Tests', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	// Runs on web, Windows, and Linux/Electron
});
```

## Fixture Mistakes

### 4. Assuming an Interpreter Persists Across Tests

`python`/`r` are test-scoped - they don't carry over from one `test()` block to the next, even in the same file.

**WRONG:**
```typescript
test('test 1', async ({ python }) => { ... });

test('test 2', async ({ app }) => {
	await app.workbench.console.executeCode('Python', 'x = 1');  // Assumes Python is still running -- not guaranteed
});
```

**CORRECT:**
```typescript
test('test 2', async ({ app, python }) => {
	await app.workbench.console.executeCode('Python', 'x = 1');
});
```

### 5. Wrong Settings Fixture Scope

`settings` is worker-scoped (shared across tests in a file), so setting it per-test can cause unexpected behavior.

**WRONG:**
```typescript
test('my test', async ({ settings }) => {
	await settings.set({ 'key': 'value' });  // Settings is worker-scoped!
});
```

**BETTER:** set it once in `test.beforeAll`:
```typescript
test.beforeAll(async ({ settings }) => {
	await settings.set({ 'key': 'value' });
});
```

**BEST:** if you already know the value up front, apply it before the app launches (via a `beforeApp` worker fixture) so there's no reload at all:
```typescript
import { test as base, expect, tags, TestFixtures, WorkerFixtures } from '../_test.setup';

const test = base.extend<TestFixtures, WorkerFixtures>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({ 'key': 'value' });
			await use();
		},
		{ scope: 'worker' }
	],
});
```

Reach for the `BETTER` form only when the value isn't known until the test runs (for example, computed from something set up earlier in the worker) and no pre-launch fixture can express it. See `references/fixtures.md`, "Custom Test Setup Files", for more pre-launch variations.

## Assertion Mistakes

### 6. Override Timeouts Only When You Know Better Than the Default

The 15s default (`expect.timeout` in `playwright.config.ts`) covers most UI checks, so don't add `{ timeout: ... }` to every assertion. Raise it only for genuinely slower operations (interpreter/kernel startup, large data loads) or lower it to fail fast; POM methods already carry these budgets, so you mostly need this on raw locators. Reflexively padding every assertion with a big timeout just hides real failures and slows the suite.

### 7. Wrapping an Already-Retrying Call in toPass

Most POM methods named `expectTo...`, `verify...`, or `waitFor...` are built on Playwright's web-first assertions (`expect(...).toBeVisible({ timeout })` and the like), so they already retry on their own until their timeout runs out. Wrapping one in an outer `toPass()` adds nothing; if it needs more time, raise its `timeout` instead.

Use `toPass` only when the action itself might need to run again, not just the check. The classic case is a click that occasionally doesn't register, where `toPass` retries the click and the assertion together:

```typescript
await expect(async () => {
	await menuTrigger.click();
	await expect(menuItem).toBeVisible({ timeout: 1000 });  // Fail fast so toPass can actually retry
}).toPass({ timeout: 5000 });
```

## Test Structure Mistakes

### 8. No Cleanup in afterEach

**WRONG:**
```typescript
test.describe('Tests', () => {
	test('test 1', async ({ app }) => {
		await app.workbench.variables.doubleClickVariableRow('df');
		// Opens data explorer tab
	});

	test('test 2', async ({ app }) => {
		// Data explorer tab still open - may interfere
	});
});
```

**CORRECT:**
```typescript
test.describe('Tests', () => {
	test.afterEach(async ({ hotKeys }) => {
		await hotKeys.closeAllEditors();
	});

	test('test 1', async ({ app }) => {
		await app.workbench.variables.doubleClickVariableRow('df');
	});

	test('test 2', async ({ app }) => {
		// Clean slate
	});
});
```

If tests edit workspace files, reset them in `afterAll` with `cleanup.discardAllChanges()` (`git reset --hard` + `git clean -fd` on the workspace) so edits don't leak into later test files:

```typescript
test.afterAll(async ({ cleanup }) => {
	await cleanup.discardAllChanges();
});
```

### 9. Double-Wrapping POM Calls in test.step

Most POM action/verification methods (e.g. `console.executeCode`, `variables.doubleClickVariableRow`, `dataExplorer.grid.verifyTableData`) already wrap their own body in `test.step(...)` internally. Wrapping one of them in another `test.step` produces a redundant nested step in the report, not a clearer one.

**WRONG:**
```typescript
test('full workflow', async ({ app, python }) => {
	await test.step('Create dataframe', async () => {
		await app.workbench.console.executeCode('Python', 'df = create_df()');  // Already wraps itself
	});

	await test.step('Open in data explorer', async () => {
		await app.workbench.variables.doubleClickVariableRow('df');  // Already wraps itself
	});
});
```

**CORRECT:**
```typescript
test('full workflow', async ({ app, python }) => {
	// No outer test.step -- each POM call already reports its own step
	await app.workbench.console.executeCode('Python', 'df = create_df()');
	await app.workbench.variables.doubleClickVariableRow('df');
	await app.workbench.dataExplorer.grid.verifyTableData(expected);

	// Reserve test.step for raw Playwright sequences that aren't already a POM call
	await test.step('Dismiss the confirmation dialog', async () => {
		await page.getByRole('button', { name: 'Delete' }).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
	});
});
```

Not every POM method self-wraps -- e.g. `console.waitForReady` and `plots.waitForNoPlots` don't. If you're unsure, grep the method's body in `test/e2e/pages/` for `test.step(`.

## Timing Mistakes

### 10. Not Waiting for Console Ready

**WRONG:**
```typescript
test('execute code', async ({ sessions, app }) => {
	await sessions.start('python');
	await app.workbench.console.executeCode('Python', 'x = 1');
	// May fail if console not ready
});
```

**CORRECT:**
```typescript
test('execute code', async ({ python, app }) => {
	// python fixture waits for ready state
	await app.workbench.console.executeCode('Python', 'x = 1');
});

// Or manually wait
test('execute code', async ({ sessions, app }) => {
	await sessions.start('python');
	await app.workbench.console.waitForReady('>>>');
	await app.workbench.console.executeCode('Python', 'x = 1');
});
```

## Environment Mistakes

### 11. Hardcoding Interpreter Versions

A hardcoded version string breaks in CI environments that provision a different interpreter.

**WRONG:**
```typescript
await notebooks.selectInterpreter('Python', 'Python 3.11.5');
```

**CORRECT, for the default interpreter:** omit the version. `selectInterpreter` already defaults it to `POSITRON_PY_VER_SEL` / `POSITRON_R_VER_SEL`, so you rarely need to pass anything:
```typescript
await notebooks.selectInterpreter('Python');
await notebooks.selectInterpreter('R');
```

**CORRECT, for a specific non-default interpreter:** pull the version from `availableRuntimes` (exported by `test/e2e/pages/sessions.ts`) instead of writing a raw string. Its keys (`python`, `pythonAlt`, `pythonHidden`, `r`, `rAlt`, `rHidden`) resolve to whatever the environment actually provisioned:
```typescript
import { availableRuntimes } from '../../pages/sessions.js';

await notebooks.selectInterpreter('Python', availableRuntimes['pythonAlt'].version);
```

### 12. Hand-Rolling Platform Key Combos Instead of Using hotKeys

Don't branch on `process.platform` to pick `Meta` vs `Control` for keyboard shortcuts -- the `hotKeys` fixture (and POM methods) already handle the platform difference.

**WRONG:**
```typescript
await page.keyboard.press('Meta+C');  // Only works on macOS
```

**CORRECT:**
```typescript
await hotKeys.copy();
```

### 13. Headless-Only Operations

**WRONG:**
```typescript
await app.workbench.plots.copyCurrentPlotToClipboard();
// Clipboard doesn't work in some headless environments
```

**CORRECT:**
```typescript
const headless = process.env.HEADLESS === 'true';
if (!headless) {
	await app.workbench.plots.copyCurrentPlotToClipboard();
}
```

## Page Object Mistakes

### 14. Direct Page Manipulation Instead of POM

**WRONG:**
```typescript
await page.locator('.console-input').click();
await page.keyboard.type('print("hello")');
await page.keyboard.press('Enter');
```

**CORRECT:**
```typescript
await app.workbench.console.pasteCodeToConsole('print("hello")', true);

// Or
await app.workbench.console.executeCode('Python', 'print("hello")');
```

Page objects encapsulate:
- Correct selectors
- Wait states
- Retry logic
- Platform handling

### 15. Not Checking Page Object Methods First

Before writing custom locator code, check the POM's source file in `test/e2e/pages/` for an existing method (see `references/page-objects.md`, "Finding the Exact Source", for how to locate it from `app.workbench.<name>`). Most common operations are already implemented -- copy the exact method name from source rather than guessing or paraphrasing it.

```typescript
// Instead of custom code, use:
await app.workbench.console.executeCode(...)
await app.workbench.variables.doubleClickVariableRow(...)
await app.workbench.dataExplorer.grid.verifyTableData(...)
await app.workbench.plots.waitForCurrentPlot()
await app.workbench.notebooks.selectInterpreter(...)
```

## Settings & Pre-Launch Configuration

### 16. Setting Config Mid-Test When Pre-Launch Would Do

Even a correctly-scoped `test.beforeAll` + `settings.set(...)` reloads the window, and for discovery/session-gating settings that reload can be flaky (it doesn't always re-run every cold-launch code path). Apply settings you know up front before the app launches instead. `references/fixtures.md`, "Custom Test Setup Files", covers the pre-launch options end to end: an existing base worker option via `test.use(...)`, a directory-wide `_test.setup.ts`, or a custom `beforeApp` override.

## Summary: Pre-Submit Checklist

Before submitting a test, verify:

- [ ] Imports from `../_test.setup`
- [ ] Has `test.use({ suiteId: __filename })`
- [ ] Uses arrow functions for test callbacks (preferred), or matches the file's existing style consistently
- [ ] Has appropriate tags (`tags.WEB`, `tags.WIN`, feature tag)
- [ ] Settings known before the test runs are applied pre-launch (`beforeApp`/`settingsFile`), not via a mid-test `settings.set()` reload
- [ ] Timeout overrides exist only where an operation is known to be slower (or should fail faster) than the 15s default -- not added reflexively to every assertion
- [ ] Uses `toPass` for potentially flaky operations
- [ ] Has cleanup in `afterEach`
- [ ] Uses page object methods instead of raw locators where possible, with method names copied from source in `test/e2e/pages/` (not guessed)
- [ ] Raw Playwright sequences (not already a POM call) are wrapped in `test.step()`; POM calls that already self-wrap are not double-wrapped
- [ ] Test is independent (doesn't rely on other tests)
