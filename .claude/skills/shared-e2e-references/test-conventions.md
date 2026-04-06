# Test Conventions

Quick reference for Positron e2e test structure, formatting, and style.

## Imports

Standard tests import from `../_test.setup` -- never from `@playwright/test`:

```typescript
import { test, expect, tags } from '../_test.setup';
```

Generated tests in `_generated/` import from `./_qa.setup`:

```typescript
import { test } from './_qa.setup';
```

## suiteId (Required)

Every test file must set `suiteId` for app isolation. Place it before `test.describe`:

```typescript
test.use({
	suiteId: __filename
});
```

Without it, tests may share app instances incorrectly and logs won't be organized by file.

## Function Syntax

Use `function` syntax for all test callbacks, not arrow functions. Required for fixture access:

```typescript
// CORRECT
test('description', async function ({ app, python }) { ... });
test.beforeEach(async function ({ app }) { ... });

// WRONG -- arrow functions can break fixture binding
test('description', async ({ app, python }) => { ... });
```

## Indentation

Use **tabs**, not spaces.

## Copyright Header

Every test file starts with:

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
```

Update the year as appropriate.

## Destructure Workbench

Destructure `app.workbench` at the top of the test body for cleaner calls:

```typescript
test('example', async function ({ app, python }) {
	const { console, variables, layouts } = app.workbench;

	await layouts.enterLayout('fullSizedAuxBar');
	await console.executeCode('Python', 'x = 42');
	await variables.expectVariableToBe('x', '42');
});
```

## Commenting Style

Write intent-driven comments, one per logical group of actions. Separate groups with blank lines. Do not comment every line.

Style reference: `test/e2e/tests/variables/variables-filter.test.ts`

```typescript
// Start R and set some variables in R and verify they are present
await sessions.start('r');
await console.executeCode('R', 'hello <- 1; foo <- 2');
await variables.expectVariableToBe('hello', '1');
await variables.expectVariableToBe('foo', '2');

// Set a filter and verify that only the filtered variable is present
await variables.setFilterText('hello');
await variables.expectVariableToBe('hello', '1');
await variables.expectVariableToNotExist('foo');
```

## test.step() Rules

Use `test.step()` to wrap raw Playwright sequences for readability in reports:

```typescript
await test.step('Verify dialog appears', async () => {
	await page.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
});
```

**NEVER wrap POM calls in `test.step()`.** POM methods already have internal `test.step()` wrappers -- double-wrapping adds noise to the report without benefit.

```typescript
// WRONG -- redundant wrapping
await test.step('Verify variable', async () => {
	await variables.expectVariableToBe('x', '42');
});

// CORRECT -- POM call stands alone
await variables.expectVariableToBe('x', '42');
```

## Tags

Add platform and feature tags to `test.describe`:

```typescript
test.describe('Feature Name', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.VARIABLES]
}, () => { ... });
```

- `tags.WEB` -- enable web browser testing
- `tags.WIN` -- enable Windows testing
- Without these, tests only run on Linux/Electron
