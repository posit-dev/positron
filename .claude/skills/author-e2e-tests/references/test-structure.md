# Test File Structure

Complete guide to structuring Playwright e2e test files in Positron.

## Test File Location

Tests are organized by feature in `test/e2e/tests/`:

```
test/e2e/tests/
  ├── _test.setup.ts       # Core setup - ALWAYS import from here
  ├── _global.setup.ts     # Global setup (runs once)
  ├── console/             # Console/REPL tests
  ├── data-explorer/       # Data Explorer tests
  ├── notebook/            # Notebook tests
  ├── plots/               # Plots tests
  ├── variables/           # Variables pane tests
  └── ...
```

## Complete Test File Template

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) <CURRENT YEAR> Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

// REQUIRED: Unique suite ID for app isolation
test.use({
	suiteId: __filename
});

test.describe('Feature Name - Subsection', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.FEATURE_TAG]
}, () => {

	// Worker-scoped setup (runs once before all tests in file)
	// If this setting is known up front, prefer applying it pre-launch instead
	// (see "Custom Test Setup Files" in references/fixtures.md) -- avoids a reload
	test.beforeAll(async ({ settings }) => {
		await settings.set({
			'some.setting': true
		});
	});

	// Test-scoped setup (runs before each test)
	test.beforeEach(async ({ app }) => {
		await app.workbench.layouts.enterLayout('fullSizedPanel');
	});

	// Test-scoped cleanup (runs after each test)
	test.afterEach(async ({ app, hotKeys }) => {
		await app.workbench.dataExplorer.filters.clearAll();
		await hotKeys.closeAllEditors();
	});

	// Worker-scoped cleanup (runs after all tests in file)
	test.afterAll(async ({ cleanup }) => {
		await cleanup.removeTestFiles(['generated-file.txt']);
	});

	// Test with auto-started interpreter
	test('Test with Python', async ({ app, python }) => {
		// Python interpreter automatically started before this runs
		await app.workbench.console.executeCode('Python', 'print("hello")');
		await app.workbench.console.waitForConsoleContents('hello');
	});

	// Test with manual session management
	test('Test with manual session', async ({ app, sessions }) => {
		await sessions.start('python');
		// ... test logic
	});

	// Test with per-test tags
	test('Specific platform test', {
		tag: [tags.WIN],  // Only on Windows
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1234' }]
	}, async ({ app, r }) => {
		// R-specific test
	});
});
```

Replace "<CURRENT YEAR>" with the current year.

## Import Rules

### Always Import from _test.setup

```typescript
// CORRECT
import { test, expect, tags } from '../_test.setup';

// WRONG - Do not import from @playwright/test
import { test, expect } from '@playwright/test';
```

The `_test.setup` provides:
- Custom `test` object with all Positron fixtures
- Re-exported `expect` from Playwright
- `tags` enum for test filtering

### Other Common Imports

```typescript
import { join } from 'path';  // For file paths
```

## suiteId Requirement

**MANDATORY**: Every test file MUST set `suiteId`:

```typescript
test.use({
	suiteId: __filename
});
```

This ensures:
- Each test file gets a fresh app instance
- Logs are organized by test file
- beforeAll/afterAll hooks run correctly per file

## Hook Scopes

Because the `app` is worker-scoped, `beforeAll`/`afterAll` run **once per test file** (not once globally): use them for worker-scoped fixtures like `settings` and for `cleanup`. `beforeEach`/`afterEach` run per test: use them for UI-state reset (`hotKeys.closeAllEditors()`, `layouts.enterLayout(...)`). See the template above for both in context.

## Function Syntax for Tests and Hooks

Arrow functions are preferred -- shorter, and the standard Playwright style:

```typescript
test('my test', async ({ app, python }) => {
	// ...
});

test.beforeEach(async ({ app }) => {
	// ...
});
```

Fixtures are delivered via the destructured parameter either way (never via `this`), so `function` syntax works identically and you'll see it throughout the existing test suite -- match a file's existing style if you're editing one rather than mixing both in the same file.

## Test Tags

### Feature Tags

Indicate what feature the test covers:

```typescript
tags.CONSOLE          // Console/REPL functionality
tags.DATA_EXPLORER    // Data Explorer
tags.NOTEBOOKS        // Jupyter notebooks
tags.PLOTS            // Plotting
tags.VARIABLES        // Variables pane
tags.CONNECTIONS      // Database connections
tags.HELP             // Help system
tags.INTERPRETER      // Interpreter management
tags.CRITICAL         // Critical path tests (high priority)
```

### Platform Tags

Control which platforms/projects run the test:

```typescript
tags.WEB      // Enable web browser testing
tags.WIN      // Enable Windows testing
tags.WORKBENCH // Enable Posit Workbench testing
```

**Default behavior**: Tests without platform tags only run on Linux/Electron.

### Applying Tags

```typescript
// Describe-level tags (apply to all tests in block)
test.describe('Console', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.CONSOLE]
}, () => { ... });

// Per-test tags (override or add to describe tags)
test('Special test', {
	tag: [tags.WIN]  // Only Windows
}, async ({ app }) => { ... });
```

## Test Annotations

Positron uses Playwright's standard `annotation` array to link tests to issues (`{ type: 'issue', description: '<url>' }`) and mark known-flaky ones (`{ type: 'fixme', description: '...' }`), passed as the second argument to `test(...)` alongside `tag`.

## Using test.step

Most POM action/verification methods already wrap themselves in `test.step` internally (see `references/page-objects.md`). Wrapping one of those calls in another `test.step` produces a redundant nested step in the report -- check the method's source before adding a wrapper.

Reserve `test.step` for raw Playwright sequences that aren't already a POM call:

```typescript
test('Complete workflow', async ({ app, python, page }) => {
	// No extra test.step needed -- each of these already wraps itself
	await app.workbench.console.executeCode('Python', 'df = pd.DataFrame(...)');
	await app.workbench.variables.doubleClickVariableRow('df');
	await app.workbench.editors.verifyTab('Data: df', { isVisible: true });
	await app.workbench.dataExplorer.grid.verifyTableData([...]);

	// DO wrap a raw multi-line Playwright sequence that isn't already a POM call
	await test.step('Dismiss the confirmation dialog', async () => {
		await page.getByRole('button', { name: 'Delete' }).click();
		await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
	});
});
```

Benefits:
- Test report shows each step without duplication
- Easier to identify where failures occur
- Self-documenting test structure

## Parallel Test Considerations

Tests in the same file share an app instance. Ensure:
- Tests don't depend on order
- Cleanup properly in afterEach
- Don't leave state that affects other tests

```typescript
test.afterEach(async ({ hotKeys, app }) => {
	// Reset UI state
	await hotKeys.closeAllEditors();
	await app.workbench.layouts.enterLayout('stacked');
});
```
