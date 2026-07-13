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

**WRONG:**
```typescript
test.describe('Console Tests', () => {
	test('my test', async function ({ app }) {
		// ...
	});
});
```

**CORRECT:**
```typescript
test.use({
	suiteId: __filename
});

test.describe('Console Tests', () => {
	test('my test', async function ({ app }) {
		// ...
	});
});
```

Without `suiteId`:
- Tests may share app instances incorrectly
- Logs won't be organized by test file
- beforeAll/afterAll won't work as expected

### 3. Arrow Functions Instead of Function Syntax

**WRONG:**
```typescript
test('my test', async ({ app, python }) => {
	// ...
});

test.beforeEach(async ({ app }) => {
	// ...
});
```

**CORRECT:**
```typescript
test('my test', async function ({ app, python }) {
	// ...
});

test.beforeEach(async function ({ app }) {
	// ...
});
```

The codebase consistently uses `function` syntax. While arrow functions sometimes work, they can cause issues with fixture access and this-binding.

### 4. Forgetting Tags for Cross-Platform Tests

**WRONG:**
```typescript
test.describe('Console Tests', () => {
	// Only runs on Linux/Electron
});
```

**CORRECT:**
```typescript
test.describe('Console Tests', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	// Runs on web, Windows, and Linux/Electron
});
```

Without platform tags:
- `tags.WEB` - test won't run in web browser mode
- `tags.WIN` - test won't run on Windows

## Fixture Mistakes

### 5. Using `python`/`r` Fixture Without Understanding Scope

**WRONG (misunderstanding):**
```typescript
test('test 1', async function ({ python }) {
	// Python starts
});

test('test 2', async function ({ app }) {
	// Assuming Python is still running - IT'S NOT GUARANTEED
	await app.workbench.console.executeCode('Python', 'x = 1');
});
```

**CORRECT:**
```typescript
test('test 2', async function ({ app, python }) {
	// python fixture ensures Python is running
	await app.workbench.console.executeCode('Python', 'x = 1');
});

// Or use sessions for manual control
test('test 2', async function ({ app, sessions }) {
	await sessions.start('python', { reuse: true });
	await app.workbench.console.executeCode('Python', 'x = 1');
});
```

### 6. Wrong Settings Fixture Scope

**WRONG:**
```typescript
test('my test', async function ({ settings }) {
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

### 7. Mixing Up Fixture Dependencies

**WRONG:**
```typescript
test('test', async function ({ page, sessions }) {
	await sessions.start('python');
	// page is derived from app, but you might not have app in scope
});
```

**CORRECT:**
```typescript
test('test', async function ({ app, sessions }) {
	await sessions.start('python');
	const page = app.code.driver.currentPage;  // Access page from app
});

// Or use page fixture directly
test('test', async function ({ page, sessions }) {
	await sessions.start('python');
	await expect(page.getByText('Python')).toBeVisible();
});
```

## Assertion Mistakes

### 8. Missing Timeouts on Async Assertions

**WRONG:**
```typescript
await expect(locator).toBeVisible();  // Uses default 5s timeout
```

**CORRECT:**
```typescript
await expect(locator).toBeVisible({ timeout: 30000 });
```

Default timeout is often too short for:
- Interpreter startup
- Code execution
- Data loading
- Network operations

### 9. Not Using toPass for Flaky Operations

**WRONG:**
```typescript
await hotKeys.clearPlots();
await app.workbench.plots.waitForNoPlots();
// May fail if clear didn't work first time
```

**CORRECT:**
```typescript
await expect(async () => {
	await hotKeys.clearPlots();
	await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
}).toPass({ timeout: 15000 });
```

Use `toPass` for:
- Clear/cleanup operations
- Menu interactions
- Dialog triggers
- Any operation that may need retry

### 10. Wrong Element Count Assertion

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

### 11. Using Unstable Selectors

**WRONG:**
```typescript
page.locator('.monaco-list-row:nth-child(3)')
page.locator('div > div > span.text')
page.locator('[style*="z-index: 1"]')
```

**CORRECT:**
```typescript
page.getByTestId('specific-element')
page.getByLabel('Button Name')
page.getByRole('button', { name: 'Submit' })
page.locator('.well-named-class').filter({ hasText: 'Expected' })
```

Prefer (in order):
1. Test IDs
2. Accessible roles/labels
3. Text content
4. Stable class names

### 12. Not Scoping Locators

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

### 13. Forgetting Exact Match

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

### 14. No Cleanup in afterEach

**WRONG:**
```typescript
test.describe('Tests', () => {
	test('test 1', async function ({ app }) {
		await app.workbench.variables.doubleClickVariableRow('df');
		// Opens data explorer tab
	});

	test('test 2', async function ({ app }) {
		// Data explorer tab still open - may interfere
	});
});
```

**CORRECT:**
```typescript
test.describe('Tests', () => {
	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('test 1', async function ({ app }) {
		await app.workbench.variables.doubleClickVariableRow('df');
	});

	test('test 2', async function ({ app }) {
		// Clean slate
	});
});
```

### 15. Tests Depending on Order

**WRONG:**
```typescript
test('step 1 - create file', async function ({ app }) {
	// Creates file
});

test('step 2 - use file', async function ({ app }) {
	// Assumes file from test 1 exists - BAD
});
```

**CORRECT:**
```typescript
test('complete workflow', async function ({ app }) {
	await test.step('Create file', async () => {
		// Create file
	});

	await test.step('Use file', async () => {
		// Use file
	});
});

// Or use beforeEach to set up state
test.beforeEach(async function ({ app }) {
	// Create file for each test
});
```

### 16. Double-Wrapping POM Calls in test.step

Most POM action/verification methods (e.g. `console.executeCode`, `variables.doubleClickVariableRow`, `dataExplorer.grid.verifyTableData`) already wrap their own body in `test.step(...)` internally. Wrapping one of them in another `test.step` produces a redundant nested step in the report, not a clearer one.

**WRONG:**
```typescript
test('full workflow', async function ({ app, python }) {
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
test('full workflow', async function ({ app, python }) {
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

### 17. Hard-Coded Waits

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

### 18. Not Waiting for Console Ready

**WRONG:**
```typescript
test('execute code', async function ({ sessions, app }) {
	await sessions.start('python');
	await app.workbench.console.executeCode('Python', 'x = 1');
	// May fail if console not ready
});
```

**CORRECT:**
```typescript
test('execute code', async function ({ python, app }) {
	// python fixture waits for ready state
	await app.workbench.console.executeCode('Python', 'x = 1');
});

// Or manually wait
test('execute code', async function ({ sessions, app }) {
	await sessions.start('python');
	await app.workbench.console.waitForReady('>>>');
	await app.workbench.console.executeCode('Python', 'x = 1');
});
```

### 19. Race Conditions with UI State

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

### 20. Hardcoding Interpreter Versions

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

### 21. Platform-Specific Code Without Guards

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

### 22. Headless-Only Operations

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

### 23. Direct Page Manipulation Instead of POM

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

### 24. Not Checking Page Object Methods First

Before writing custom locator code, check `references/generated/<pomName>.md` (or `references/generated/index.md` to find the right file) for an existing method. Most common operations are already implemented -- copy the exact method name from there rather than guessing or paraphrasing it.

```typescript
// Instead of custom code, use:
await app.workbench.console.executeCode(...)
await app.workbench.variables.doubleClickVariableRow(...)
await app.workbench.dataExplorer.grid.verifyTableData(...)
await app.workbench.plots.waitForCurrentPlot()
await app.workbench.notebooks.selectInterpreter(...)
```

## Debugging Mistakes

### 25. Not Using --headed or --debug

When tests fail, always try:

```bash
# See what's happening
npx playwright test my-test.test.ts --headed

# Step through interactively
npx playwright test my-test.test.ts --debug
```

### 26. Not Checking Test Reports

After failures:

```bash
npx playwright show-report
```

Reports include:
- Screenshots at failure
- Traces (if enabled)
- Step-by-step execution
- Error messages with context

## Fixture vs. POM Confusion

### 27. Confusing the `settings` Fixture with `app.workbench.settings`

The `settings` fixture (test function parameter) and `app.workbench.settings` (the `UserSettings` POM) are different objects. Both happen to have a `.remove()` method, which makes it easy to grab the wrong one. Methods that take a settings argument, like `notebooksPositron.enablePositronNotebooks(settings)`, expect the **fixture**, not the workbench POM.

**WRONG:**
```typescript
test('example', async function ({ app }) {
	const { notebooksPositron, settings } = app.workbench;
	await notebooksPositron.enablePositronNotebooks(settings);  // BREAKS -- app.workbench.settings, wrong type
});
```

**CORRECT:**
```typescript
test('example', async function ({ app, settings }) {
	await app.workbench.notebooksPositron.enablePositronNotebooks(settings);  // settings fixture
});
```

The `settings` fixture has `.set()`, `.clear()`, `.remove()`, with reload options (see `references/fixtures.md`). The `app.workbench.settings` POM (`UserSettings`) has `.mergeSetting()`, `.getSettings()`, `.remove()`. Don't mix them up.

### 28. `enablePositronNotebooks` Needs the Settings Fixture and Triggers a Reload

`notebooksPositron.enablePositronNotebooks(settings)` takes the `settings` fixture and internally calls `settings.set(..., { reload: 'web' })` -- it always reloads the window to make the setting take effect.

**WRONG:**
```typescript
test('example', async function ({ app }) {
	await app.workbench.notebooksPositron.enablePositronNotebooks();  // Missing required settings argument
});
```

**CORRECT:**
```typescript
test('example', async function ({ app, settings }) {
	await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
});
```

To avoid the reload cost, set `positron.notebook.enabled` via `settingsFile.append()` in a `beforeApp` worker fixture instead, so it's applied before the app starts (see the "Custom Test Setup Files" example in `references/fixtures.md`).

## Summary: Pre-Submit Checklist

Before submitting a test, verify:

- [ ] Imports from `../_test.setup`
- [ ] Has `test.use({ suiteId: __filename })`
- [ ] Uses `function` syntax (not arrow functions)
- [ ] Has appropriate tags (`tags.WEB`, `tags.WIN`, feature tag)
- [ ] All assertions have explicit timeouts for async operations
- [ ] Uses `toPass` for potentially flaky operations
- [ ] Has cleanup in `afterEach`
- [ ] Uses environment variables for interpreter versions
- [ ] Uses page object methods instead of raw locators where possible, with method names copied from `references/generated/<pomName>.md` (not guessed)
- [ ] Raw Playwright sequences (not already a POM call) are wrapped in `test.step()`; POM calls that already self-wrap are not double-wrapped
- [ ] Test is independent (doesn't rely on other tests)
