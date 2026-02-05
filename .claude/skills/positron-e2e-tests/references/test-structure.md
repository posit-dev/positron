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
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
	test.beforeAll(async ({ settings }) => {
		await settings.set({
			'some.setting': true
		});
	});

	// Test-scoped setup (runs before each test)
	test.beforeEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('fullSizedPanel');
	});

	// Test-scoped cleanup (runs after each test)
	test.afterEach(async function ({ app, hotKeys }) {
		await app.workbench.dataExplorer.filters.clearAll();
		await hotKeys.closeAllEditors();
	});

	// Worker-scoped cleanup (runs after all tests in file)
	test.afterAll(async function ({ cleanup }) {
		await cleanup.removeTestFiles(['generated-file.txt']);
	});

	// Test with auto-started interpreter
	test('Test with Python', async function ({ app, python }) {
		// Python interpreter automatically started before this runs
		await app.workbench.console.executeCode('Python', 'print("hello")');
		await app.workbench.console.waitForConsoleContents('hello');
	});

	// Test with manual session management
	test('Test with manual session', async function ({ app, sessions }) {
		await sessions.start('python');
		// ... test logic
	});

	// Test with per-test tags
	test('Specific platform test', {
		tag: [tags.WIN],  // Only on Windows
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1234' }]
	}, async function ({ app, r }) {
		// R-specific test
	});
});
```

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

## Test Organization

### Describe Blocks

Use `test.describe` to group related tests:

```typescript
test.describe('Console Input', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	// Tests for console input functionality
});

// Nested describes for sub-features
test.describe('Console History', () => {
	test.describe('Navigation', () => {
		// History navigation tests
	});

	test.describe('Search', () => {
		// History search tests
	});
});
```

### Test Naming

Use descriptive names that indicate:
1. The interpreter/language (if applicable)
2. What is being tested
3. Expected outcome

```typescript
// Good names
test('Python - Can execute multi-line code in console');
test('R - Verify plot renders with correct dimensions');
test('Verify data explorer filters work with numeric columns');

// Bad names
test('test1');
test('console works');
test('execute code');
```

## Hook Scopes

### Worker-Scoped (beforeAll/afterAll)

Run once per test file. Use for:
- Setting up user settings
- Creating shared resources
- Final cleanup

```typescript
test.beforeAll(async ({ settings }) => {
	// Runs once before all tests in this file
	await settings.set({ 'editor.fontSize': 14 });
});

test.afterAll(async ({ cleanup }) => {
	// Runs once after all tests in this file
	await cleanup.removeTestFiles(['output.txt']);
});
```

### Test-Scoped (beforeEach/afterEach)

Run before/after each test. Use for:
- UI state reset
- Closing editors
- Clearing state

```typescript
test.beforeEach(async function ({ app }) {
	await app.workbench.layouts.enterLayout('fullSizedPanel');
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});
```

## Function Syntax Requirement

**IMPORTANT**: Use `function` syntax (not arrow functions) for tests and hooks:

```typescript
// CORRECT - function syntax
test('my test', async function ({ app, python }) {
	// ...
});

test.beforeEach(async function ({ app }) {
	// ...
});

// INCORRECT - arrow function
test('my test', async ({ app, python }) => {
	// ...
});
```

While arrow functions often work, `function` syntax is the established pattern in the codebase and ensures proper fixture access.

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
}, async function ({ app }) { ... });
```

## Test Annotations

Add metadata to tests for tracking:

```typescript
test('Flaky test', {
	annotation: [
		{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1234' },
		{ type: 'fixme', description: 'Flaky on CI - timing issue' }
	]
}, async function ({ app }) { ... });
```

## Using test.step

Wrap logical groups of actions in `test.step` for better reporting:

```typescript
test('Complete workflow', async function ({ app, python }) {
	await test.step('Create dataframe', async () => {
		await app.workbench.console.executeCode('Python', 'df = pd.DataFrame(...)');
	});

	await test.step('Open in data explorer', async () => {
		await app.workbench.variables.doubleClickVariableRow('df');
		await app.workbench.editors.verifyTab('Data: df', { isVisible: true });
	});

	await test.step('Verify data', async () => {
		await app.workbench.dataExplorer.grid.verifyTableData([...]);
	});
});
```

Benefits:
- Test report shows each step
- Easier to identify where failures occur
- Self-documenting test structure

## Parallel Test Considerations

Tests in the same file share an app instance. Ensure:
- Tests don't depend on order
- Cleanup properly in afterEach
- Don't leave state that affects other tests

```typescript
test.afterEach(async function ({ hotKeys, app }) {
	// Reset UI state
	await hotKeys.closeAllEditors();
	await app.workbench.layouts.enterLayout('stacked');
});
```
