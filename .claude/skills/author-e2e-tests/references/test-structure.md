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

	// Worker-scoped setup runs once per file. For settings known up front, apply
	// them pre-launch instead of here (see "Custom Test Setup Files" in
	// references/fixtures.md) so there's no reload.

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

The template's two required lines -- importing from `../_test.setup` (not `@playwright/test`) and `test.use({ suiteId: __filename })` -- are mandatory for every file. Import only what the file uses: `test` and `tags` always, `expect` only when you write raw assertions (drop it when every assertion goes through a POM method, or the unused import fails lint). SKILL.md lists the requirements under "MANDATORY REQUIREMENTS"; `references/common-mistakes.md` #1 and #2 explain what breaks without them.

## Hook Scopes

Because the `app` is worker-scoped, `beforeAll`/`afterAll` run **once per test file** (not once globally): use them for worker-scoped fixtures like `settings` and for `cleanup`. `beforeEach`/`afterEach` run per test: use them for UI-state reset (`hotKeys.closeAllEditors()`, `layouts.enterLayout(...)`). See the template above for both in context.

## Test Tags

Tag each `test.describe` via the `tag` array, and override per-test where needed. The available tags are the `FeatureTags` (what the test covers) and `PlatformTags` (where it runs) enums in `test/e2e/infra/test-runner/test-tags.ts` -- read those rather than a hardcoded list here. A test with no platform tag runs only on Linux/Electron; add `tags.WEB` / `tags.WIN` to broaden.

```typescript
// Describe-level tags apply to every test in the block; a per-test `tag` overrides/adds
test.describe('Console', { tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.CONSOLE] }, () => { ... });
```

## Test Annotations

Positron uses Playwright's standard `annotation` array to link tests to issues (`{ type: 'issue', description: '<url>' }`) and mark known-flaky ones (`{ type: 'fixme', description: '...' }`), passed as the second argument to `test(...)` alongside `tag`.

## Using test.step

Most POM action/verification methods already wrap themselves in `test.step` internally, so wrapping a POM call in another `test.step` just adds a redundant nested step. Reserve `test.step` for raw Playwright sequences that aren't already a POM call. See `references/common-mistakes.md` #9 for the full pattern and the methods that don't self-wrap.

## Parallel Test Considerations

Tests in the same file share one app instance (worker-scoped), so they must not depend on run order. Reset UI state in `afterEach` (see #8 in `references/common-mistakes.md`) so state from one test doesn't leak into the next.
