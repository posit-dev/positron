# Test Fixtures

All available fixtures in Positron's e2e test system, their scopes, and usage patterns.

## Fixture Table

| Fixture | Scope | Use Case |
|---------|-------|----------|
| `app` | Worker | Access workbench page objects: `app.workbench.console`, etc. |
| `page` | Test | Direct Playwright page access: `page.getByLabel(...)` |
| `python` | Test | Auto-start Python interpreter before test |
| `r` | Test | Auto-start R interpreter before test |
| `sessions` | Test | Manual session management: `await sessions.start('python')` |
| `executeCode` | Test | Execute code: `await executeCode('Python', 'print("hi")')` |
| `openFile` | Test | Open file: `await openFile('workspaces/test/file.py')` |
| `hotKeys` | Test | Keyboard shortcuts: `await hotKeys.closeAllEditors()` |
| `settings` | Worker | Change settings: `await settings.set({ 'key': value })` |
| `cleanup` | Test | Remove test files: `await cleanup.removeTestFiles([...])` |

## Worker-Scoped vs Test-Scoped

- **Worker-scoped** (one instance per test file, shared across tests): `app`, `settings`, `settingsFile`, `logger`
- **Test-scoped** (fresh instance per test): `page`, `sessions`, `python`, `r`, `executeCode`, `openFile`, `hotKeys`, `cleanup`

Worker-scoped fixtures belong in `test.beforeAll`/`test.afterAll`. Test-scoped fixtures belong in individual tests or `test.beforeEach`/`test.afterEach`.

## Core Fixtures

### app

```typescript
test('example', async function ({ app }) {
	const { console, variables, dataExplorer } = app.workbench;
	await console.executeCode('Python', 'x = 1');
	const page = app.code.driver.page;  // Access raw page
});
```

### page

Shorthand for `app.code.driver.page`:

```typescript
test('example', async function ({ page }) {
	await page.getByLabel('Start Interpreter').click();
	await expect(page.getByText('Python')).toBeVisible();
});
```

### python / r

Auto-start interpreters. The fixture waits for the console to be ready:

```typescript
test('Python test', async function ({ app, python }) {
	// Python already started, console ready with >>> prompt
	await app.workbench.console.executeCode('Python', 'print("hello")');
});
```

### sessions

Manual session management with more control:

```typescript
test('example', async function ({ sessions }) {
	await sessions.start('python');
	await sessions.start('r');
	await sessions.start('pythonAlt');   // Alternate Python version
	await sessions.start('python', { reuse: true });
});
```

## When to Use `python` Fixture vs `sessions.start()`

**Use `python`/`r` fixtures** for simple cases where you just need an interpreter running:

```typescript
test('simple case', async function ({ app, python }) {
	await app.workbench.console.executeCode('Python', 'x = 1');
});
```

**Use `sessions.start()` with destructuring** when you need session IDs (multi-session, switching, restart by ID):

```typescript
test('multi-session', async function ({ app, sessions }) {
	const [pySession] = await sessions.start(['python']);
	const [rSession] = await sessions.start(['r']);
	await sessions.select(pySession.sessionId);
	// ...
	await sessions.select(rSession.sessionId);
});
```

**BAD pattern** -- starting via fixture then looking up ID:

```typescript
// WRONG: Don't fish for session IDs after fixture start
test('bad pattern', async function ({ app, python, sessions }) {
	const pythonSessionId = (await sessions.getAllSessionIdsAndNames())
		.find(s => s.name.includes('Python'))!.id;
});
```

## Settings Fixture

Worker-scoped -- use in `beforeAll`, not in individual tests:

```typescript
test.beforeAll(async ({ settings }) => {
	await settings.set({
		'editor.fontSize': 14,
		'positron.notebook.enabled': true
	});

	// With options
	await settings.set({ 'key': 'value' }, {
		reload: true,        // Reload window after setting
		waitForReady: true,  // Wait for app ready
	});

	// Clear all
	await settings.clear();
});
```

## Utility Fixtures

### executeCode

```typescript
test('example', async function ({ executeCode }) {
	await executeCode('Python', 'print("hello")');
	await executeCode('Python', 'long_running()', { timeout: 60000 });
});
```

### openFile

```typescript
test('example', async function ({ openFile }) {
	await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
});
```

### hotKeys

```typescript
test('example', async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
	await hotKeys.copy();
	await hotKeys.paste();
	await hotKeys.focusConsole();
	await hotKeys.clearPlots();
});
```

### cleanup

```typescript
test.afterAll(async function ({ cleanup }) {
	await cleanup.removeTestFiles(['output.txt', 'generated.csv']);
});
```

## Fixture Dependency Tree

```
app
 +-- page (derived from app.code.driver.page)
 +-- sessions (derived from app.workbench.sessions)
 +-- hotKeys (derived from app.workbench.hotKeys)
 +-- executeCode (uses app.workbench.console)
 +-- openFile/openDataFile/openFolder (use app)

python, r -> sessions -> app
settings -> app
```

## $pom References (Explore Runner)

When a POM method takes another POM as a parameter, use `{"$pom": "<name>"}` in args. The runner resolves it at runtime:

```json
{"type": "pom", "pom": "notebooksPositron", "method": "enablePositronNotebooks", "args": [{"$pom": "settings"}]}
```

Works for any POM name on the workbench: `settings`, `sessions`, `console`, etc.

## Setup Patterns from Existing Tests

Before writing a test, check existing tests in the same area for required setup:

- `enablePositronNotebooks(settings)` -- Positron notebooks are behind a feature flag
- `settings.set({...}, { reload: true })` -- feature flags that require a reload
- `assistant.loginModelProvider(...)` -- AI provider setup

```bash
ls test/e2e/tests/<area>/*.test.ts 2>/dev/null | head -3
```

Read the imports and `beforeAll`/`beforeEach` hooks from those files to identify patterns.

## Custom Test Setup Files

Some test categories extend the base fixtures:

```typescript
// test/e2e/tests/notebooks-positron/_test.setup.ts
import { test as base, expect, tags } from '../_test.setup';

export const test = base.extend({
	beforeApp: async ({ settingsFile }, use) => {
		await settingsFile.write({
			'positron.notebook.enabled': true,
		});
		await use();
	}
});

export { expect, tags };
```

Import from the local `_test.setup` when it exists:

```typescript
import { test, expect, tags } from './_test.setup';  // local override
import { test, expect, tags } from '../_test.setup';  // default
```
