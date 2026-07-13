# Common Mistakes and Gotchas

Comprehensive list of mistakes to avoid when writing Positron e2e tests.

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

`python`/`r` are test-scoped -- they don't carry over from one `test()` block to the next, even in the same file.

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

**WRONG:**
```typescript
test('my test', async ({ settings }) => {
	await settings.set({ 'key': 'value' });  // Settings is worker-scoped!
});
```

**CORRECT:**
```typescript
test.beforeAll(async ({ settings }) => {
	await settings.set({ 'key': 'value' });
});
```

`settings` is worker-scoped (shared across tests in a file). Setting it per-test can cause unexpected behavior.

**Even better, when the setting is known up front:** apply it before the app launches instead of in `test.beforeAll`, so there's no reload at all -- see #26. Reach for `test.beforeAll` + `settings.set()` when the value can't be known until runtime (e.g. computed from something set up earlier in the worker) and a pre-launch fixture genuinely can't express it.

## Assertion Mistakes

### 6. Timeout Overrides -- Only When You Know Better Than the Default

The configured default assertion timeout is already 15s (`expect.timeout` in `playwright.config.ts`), which covers most UI visibility checks -- you don't need to add `{ timeout: ... }` to every assertion.

Override it deliberately: raise it for operations known to be slower than typical UI (interpreter startup, code execution, data loading, network calls -- see the Timeout Guidelines table in `references/assertions.md` for recommended values per operation), or lower it for an assertion that should genuinely fail fast.

```typescript
// Default 15s is fine for a normal UI check -- no override needed
await expect(locator).toBeVisible();

// Override upward for a known-slow operation
await expect(locator).toBeVisible({ timeout: 60000 });  // e.g. large data load
```

**Anti-pattern:** don't reflexively add a large timeout (e.g. `{ timeout: 60000 }`) to every assertion "just in case." That delays failure detection when something is actually broken and slows down the whole suite on a real regression.

### 7. Wrapping an Already-Retrying Call in toPass

Most POM methods named `expectTo...`, `verify...`, or `waitFor...` are built on Playwright's web-first assertions (`expect(...).toBeVisible({ timeout })` and similar), which already poll/retry internally until their own timeout elapses. Wrapping one in an outer `toPass()` is redundant -- raise its `timeout` option instead if it needs more time.

`toPass` earns its place when the **action itself** -- not just the resulting state -- might need to be reissued, e.g. a click that occasionally doesn't register and needs retrying along with the check:

```typescript
await expect(async () => {
	await menuTrigger.click();
	await expect(menuItem).toBeVisible();
}).toPass({ timeout: 5000 });
```

### 8. Wrong Element Count Assertion

**WRONG:**
```typescript
// Checking if element exists
await expect(locator).toBeVisible();  // Fails if multiple match

// Checking if element doesn't exist
await expect(locator).not.toBeVisible();  // May pass if one is hidden
```

**CORRECT:**
```typescript
// Element should exist (one or more)
await expect(locator).toHaveCount(1, { timeout: 15000 });

// Element should not exist
await expect(locator).toHaveCount(0, { timeout: 5000 });
```

## Locator Mistakes

### 9. Using Unstable Selectors

**WRONG:**
```typescript
page.locator('.monaco-list-row:nth-child(3)')
page.locator('div > div > span.text')
page.locator('[style*="z-index: 1"]')
```

**CORRECT:**
```typescript
page.getByRole('button', { name: 'Submit' })
```

See `references/assertions.md`'s "Preferred Selectors" for the full priority order and rationale.

### 10. Not Scoping Locators

**WRONG:**
```typescript
// Finds ALL buttons on page
await page.getByRole('button', { name: 'OK' }).click();
```

**CORRECT:**
```typescript
// Scoped to specific dialog
const dialog = page.locator('.my-dialog');
await dialog.getByRole('button', { name: 'OK' }).click();

// Or use filter
await page.getByRole('button', { name: 'OK' })
	.filter({ has: page.locator('.dialog-footer') })
	.click();
```

### 11. Forgetting Exact Match

**WRONG:**
```typescript
page.getByText('Console')  // Matches "Console", "Console Tab", "Active Console"
```

**CORRECT:**
```typescript
page.getByText('Console', { exact: true })
page.getByRole('tab', { name: 'Console', exact: true })
```

## Test Structure Mistakes

### 12. No Cleanup in afterEach

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

### 13. Tests Depending on Order

**WRONG:**
```typescript
test('step 1 - create file', async ({ app }) => {
	// Creates file
});

test('step 2 - use file', async ({ app }) => {
	// Assumes file from test 1 exists - BAD
});
```

**CORRECT:**
```typescript
test('complete workflow', async ({ app }) => {
	await test.step('Create file', async () => {
		// Create file
	});

	await test.step('Use file', async () => {
		// Use file
	});
});

// Or use beforeEach to set up state
test.beforeEach(async ({ app }) => {
	// Create file for each test
});
```

### 14. Double-Wrapping POM Calls in test.step

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

### 15. Hard-Coded Waits

**WRONG:**
```typescript
await page.waitForTimeout(5000);  // Just waiting...
await button.click();
```

**CORRECT:**
```typescript
await expect(button).toBeEnabled({ timeout: 5000 });
await button.click();

// Or wait for specific state
await page.waitForLoadState('networkidle');
await button.click();
```

### 16. Not Waiting for Console Ready

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

### 17. Race Conditions with UI State

**WRONG:**
```typescript
await triggerButton.click();
await dialogContent.textContent();  // Dialog may not be open yet
```

**CORRECT:**
```typescript
await triggerButton.click();
await expect(dialog).toBeVisible({ timeout: 5000 });
const content = await dialogContent.textContent();
```

## Environment Mistakes

### 18. Hardcoding Interpreter Versions

**WRONG:**
```typescript
await notebooks.selectInterpreter('Python', 'Python 3.11.5');
```

**CORRECT:**
```typescript
await notebooks.selectInterpreter('Python', process.env.POSITRON_PY_VER_SEL!);
await notebooks.selectInterpreter('R', process.env.POSITRON_R_VER_SEL!);
```

Environment variables ensure tests work across different CI environments.

### 19. Platform-Specific Code Without Guards

**WRONG:**
```typescript
await page.keyboard.press('Meta+C');  // Only works on macOS
```

**CORRECT:**
```typescript
if (process.platform === 'darwin') {
	await page.keyboard.press('Meta+C');
} else {
	await page.keyboard.press('Control+C');
}

// Or use hotKeys which handles this
await hotKeys.copy();
```

### 20. Headless-Only Operations

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

### 21. Direct Page Manipulation Instead of POM

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

### 22. Not Checking Page Object Methods First

Before writing custom locator code, check the POM's source file in `test/e2e/pages/` for an existing method (see `references/page-objects.md`, "Finding the Exact Source", for how to locate it from `app.workbench.<name>`). Most common operations are already implemented -- copy the exact method name from source rather than guessing or paraphrasing it.

```typescript
// Instead of custom code, use:
await app.workbench.console.executeCode(...)
await app.workbench.variables.doubleClickVariableRow(...)
await app.workbench.dataExplorer.grid.verifyTableData(...)
await app.workbench.plots.waitForCurrentPlot()
await app.workbench.notebooks.selectInterpreter(...)
```

## Debugging Mistakes

### 23. Not Using --headed or --debug

When tests fail, always try:

```bash
# See what's happening
npx playwright test my-test.test.ts --headed

# Step through interactively
npx playwright test my-test.test.ts --debug
```

### 24. Not Checking Test Reports

After failures:

```bash
npx playwright show-report
```

Reports include:
- Screenshots at failure
- Traces (if enabled)
- Step-by-step execution
- Error messages with context

## Settings & Pre-Launch Configuration

### 25. `enablePositronNotebooks` Needs the Settings Fixture and Triggers a Reload

`notebooksPositron.enablePositronNotebooks(settings)` takes the `settings` fixture and internally calls `settings.set(..., { reload: 'web' })` -- it always reloads the window to make the setting take effect.

**WRONG:**
```typescript
test('example', async ({ app }) => {
	await app.workbench.notebooksPositron.enablePositronNotebooks();  // Missing required settings argument
});
```

**CORRECT:**
```typescript
test('example', async ({ app, settings }) => {
	await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
});
```

To avoid the reload cost, set `positron.notebook.enabled` via `settingsFile.append()` in a `beforeApp` worker fixture instead, so it's applied before the app starts (see the "Custom Test Setup Files" example in `references/fixtures.md`).

### 26. Setting Config Mid-Test When Pre-Launch Would Do

More generally than #25: any `settings.set(...)` after the app has launched costs a reload, and for discovery/session-gating settings a reload can be flaky (it doesn't always re-run every cold-launch code path).

**WRONG:**
```typescript
test.beforeAll(async ({ settings }) => {
	await settings.set({ 'some.gating.setting': true }, { reload: true });
});
```

**CORRECT -- setting is already a base worker option** (check `test/e2e/tests/_test.setup.ts` for `useLegacyNotebookEditor`, `enableDataConnections`, `enableFoundryAssistant`):
```typescript
test.use({ useLegacyNotebookEditor: true });   // No custom setup file needed
```

**CORRECT -- no existing option covers it, isolated to one file:**
```typescript
import { test as base, expect, tags, TestFixtures, WorkerFixtures } from '../_test.setup';

const test = base.extend<TestFixtures, WorkerFixtures>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({ 'some.gating.setting': true });
			await use();
		},
		{ scope: 'worker' }
	],
});
```

**CORRECT -- applies to a whole feature directory:** put either form above in a `_test.setup.ts` in that directory (see `test/e2e/tests/notebook/_test.setup.ts` for overriding an existing option, `test/e2e/tests/notebooks-positron/_test.setup.ts` for defining a new one) and have every file in the directory import `test` from `./_test.setup.js` instead of `../_test.setup`.

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
- [ ] Uses environment variables for interpreter versions
- [ ] Uses page object methods instead of raw locators where possible, with method names copied from source in `test/e2e/pages/` (not guessed)
- [ ] Raw Playwright sequences (not already a POM call) are wrapped in `test.step()`; POM calls that already self-wrap are not double-wrapped
- [ ] Test is independent (doesn't rely on other tests)
