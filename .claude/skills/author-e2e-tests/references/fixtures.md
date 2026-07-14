# Test Fixtures

Complete documentation of all available fixtures in Positron's e2e test system.

## Fixture Scopes

Fixtures have two scopes:
- **Worker-scoped**: One instance per test file (shared across tests)
- **Test-scoped**: Fresh instance for each test

## Core Fixtures

### app (Worker-scoped)

The main application instance. Provides access to all page objects.

```typescript
test('example', async ({ app }) => {
	// Access workbench page objects
	await app.workbench.console.executeCode('Python', 'x = 1');
	await app.workbench.variables.doubleClickVariableRow('x');

	// Access workspace path
	const workspacePath = app.workspacePathOrFolder;

	// Access page directly
	const page = app.code.driver.currentPage;
});
```

### page (Test-scoped)

Shorthand for `app.code.driver.currentPage`. Direct Playwright Page access.

```typescript
test('example', async ({ page }) => {
	// Direct locator access
	await page.getByLabel('Start Interpreter').click();
	await expect(page.getByText('Python')).toBeVisible();
});
```

### sessions (Test-scoped)

Session/interpreter management.

```typescript
test('example', async ({ sessions }) => {
	// Start specific interpreter
	await sessions.start('python');
	await sessions.start('r');
	await sessions.start('pythonAlt');  // Alternate Python version
	await sessions.start('rAlt');       // Alternate R version

	// Start with options
	await sessions.start('python', { reuse: true });

	// Wait for all sessions to be ready
	await sessions.expectAllSessionsToBeReady({ timeout: 15000 });

	// Check session status
	await sessions.expectStatusToBe('session-id', 'idle');
});
```

### python (Test-scoped)

Auto-starts Python interpreter before test runs.

```typescript
test('Python test', async ({ app, python }) => {
	// Python interpreter already started
	// Console is ready with >>> prompt
	await app.workbench.console.executeCode('Python', 'print("hello")');
});
```

### r (Test-scoped)

Auto-starts R interpreter before test runs.

```typescript
test('R test', async ({ app, r }) => {
	// R interpreter already started
	// Console is ready with > prompt
	await app.workbench.console.executeCode('R', 'print("hello")');
});
```

## File Operation Fixtures

### openFile (Test-scoped)

Opens a file from the workspace.

```typescript
test('example', async ({ openFile }) => {
	// Path relative to qa-example-content
	await openFile('workspaces/basic-rmd-file/basicRmd.rmd');

	// With wait option
	await openFile('workspaces/test/file.py', true);  // Wait for focus
});
```

### openDataFile (Test-scoped)

Opens a data file (for data explorer).

```typescript
test('example', async ({ openDataFile }) => {
	await openDataFile('workspaces/large_r_notebook/spotify.ipynb');
});
```

### openFolder (Test-scoped)

Opens a folder.

```typescript
test('example', async ({ openFolder }) => {
	await openFolder('qa-example-content/workspaces/r_testing');
});
```

## Code Execution Fixtures

### executeCode (Test-scoped)

Execute code in the console.

```typescript
test('example', async ({ executeCode }) => {
	// Basic execution
	await executeCode('Python', 'print("hello")');
	await executeCode('R', 'print("world")');

	// With options
	await executeCode('Python', 'long_running()', {
		timeout: 60000,
		waitForReady: true,
		maximizeConsole: true
	});
});
```

### runCommand (Test-scoped)

Run a VS Code command via quick access.

```typescript
test('example', async ({ runCommand }) => {
	// Run command
	await runCommand('workbench.action.files.save');

	// With options
	await runCommand('some.command', { keepOpen: true, exactMatch: true });
});
```

### saveFileAs (Test-scoped)

Save the current file to a new path via the "Save As" dialog.

```typescript
test('example', async ({ saveFileAs, app }) => {
	await saveFileAs(join(app.workspacePathOrFolder, 'newfile.txt'));
});
```

## Settings Fixtures

### settings (Worker-scoped)

Manage user settings.

```typescript
test.beforeAll(async ({ settings }) => {
	// Set settings
	await settings.set({
		'editor.fontSize': 14,
		'files.autoSave': 'off',
		'positron.notebook.enabled': true
	});

	// With options
	await settings.set({ 'key': 'value' }, {
		reload: true,       // Reload window after setting; also accepts 'web'
		waitMs: 1000,       // Wait after setting
		waitForReady: true, // Wait for app ready
		keepOpen: false     // Close settings UI
	});

	// Clear all custom settings
	await settings.clear();

	// Remove specific settings
	await settings.remove(['editor.fontSize', 'files.autoSave']);
});
```

### settingsFile (Worker-scoped)

Direct settings file access, for settings that need to be set before the app starts (i.e. from a `beforeApp` worker fixture, before `app.beforeAll`). Both `settingsFile` and `vsCodeSettings` are instances of the same `SettingsFile` class; `settingsFile` points at the user data dir, `vsCodeSettings` at VS Code's own settings path.

```typescript
test.beforeAll(async ({ settingsFile }) => {
	// Merge settings directly into the file -- there is no .write(), only .append()
	await settingsFile.append({
		'positron.notebook.enabled': true
	});

	// Other methods
	await settingsFile.exists();
	await settingsFile.ensureExists();
	await settingsFile.backupIfExists();
	await settingsFile.restoreFromBackup();
	await settingsFile.delete();
});
```

### vsCodeSettings (Worker-scoped)

Access VS Code's settings file (separate from user data dir settings). Same API as `settingsFile` above (`.append()`, not `.write()`).

```typescript
test.beforeAll(async ({ vsCodeSettings }) => {
	await vsCodeSettings.append({ 'key': 'value' });
});
```

## Utility Fixtures

### hotKeys (Test-scoped)

Keyboard shortcuts and UI actions.

```typescript
test('example', async ({ hotKeys }) => {
	// Editor actions
	await hotKeys.copy();
	await hotKeys.paste();
	await hotKeys.selectAll();
	await hotKeys.closeAllEditors();

	// Layout actions
	await hotKeys.stackedLayout();
	await hotKeys.notebookLayout();
	await hotKeys.fullSizeSecondarySidebar();

	// Sidebar actions
	await hotKeys.showSecondarySidebar();
	await hotKeys.closeSecondarySidebar();
	await hotKeys.closePrimarySidebar();  // No corresponding showPrimarySidebar()

	// Panel actions
	await hotKeys.toggleBottomPanel();
	await hotKeys.focusConsole();

	// Execution control
	await hotKeys.sendInterrupt();

	// Plots
	await hotKeys.clearPlots();
});
```

### packages (Test-scoped)

Package management utilities.

```typescript
test('example', async ({ packages }) => {
	// Install package
	await packages.manage('snowflake', 'install');

	// Uninstall package
	await packages.manage('renv', 'uninstall');
});
```

### cleanup (Test-scoped)

Test cleanup utilities (`TestTeardown`).

```typescript
test.afterAll(async ({ cleanup }) => {
	// Remove specific files created during the test
	await cleanup.removeTestFiles(['output.txt', 'generated.csv']);

	// Remove an entire folder created during the test
	await cleanup.removeTestFolder('generated-output');

	// Reset the whole workspace (git reset --hard + git clean -fd) --
	// use when tests edit existing workspace files, so edits don't leak
	// into later test files
	await cleanup.discardAllChanges();
});
```

### devTools (Test-scoped)

Opens DevTools before test.

```typescript
test('debug test', async ({ devTools, app }) => {
	// DevTools already open
	// Useful for debugging
});
```

### restartApp (Test-scoped)

Restarts the app before test runs.

```typescript
test('fresh app test', async ({ restartApp: app }) => {
	// App has been restarted
	// Fresh state
});
```

### metric (Test-scoped)

Record performance metrics. There is no generic `.record()` -- each domain has its own namespaced recorder:

```typescript
test('performance test', async ({ metric, app }) => {
	await metric.dataExplorer.loadData(async () => {
		await app.workbench.dataExplorer.grid.getData();
	}, 'my-target-name');

	await metric.console.executeCode(async () => {
		await app.workbench.console.executeCode('Python', code);
	}, 'my-target-name');

	// Also available: metric.dataExplorer.{filter, sort, toCode},
	// metric.notebooks.{runCell, renderOnOpen, renderOnNavBack, renderOnColdOpen},
	// metric.sessions.start, metric.assistant.evalResponse
});
```

See `test/e2e/utils/metrics/` for the full signature of each recorder.

### assistant (Test-scoped)

Shorthand for `app.workbench.assistant` (Positron Assistant page object).

```typescript
test('example', async ({ assistant }) => {
	// Equivalent to app.workbench.assistant
});
```

### logger (Worker-scoped)

Logging utilities.

```typescript
test('example', async ({ app, logger }) => {
	logger.log('Starting test operation');
	await app.workbench.console.executeCode('Python', 'x = 1');
	logger.log('Operation completed');
});
```

## Docker Fixtures (Workbench/Remote only)

### runDockerCommand

Execute commands in Docker container. Only available in the `e2e-workbench`, `e2e-jupyter`, `e2e-remote-ssh`, and `e2e-connect` projects.

```typescript
test('docker test', async ({ runDockerCommand }) => {
	const result = await runDockerCommand('ls -la', 'List files');
	// result.stdout, result.stderr, result.exitCode
});
```

## Fixture Dependencies

Some fixtures depend on others:

```
app
 ├── page (derived from app.code.driver.currentPage)
 ├── sessions (derived from app.workbench.sessions)
 ├── hotKeys (derived from app.workbench.hotKeys)
 ├── executeCode (uses app.workbench.console)
 └── openFile/openDataFile/openFolder (use app)

python, r → sessions → app
settings → app
settingsFile → userDataDir → options
```

## Custom Test Setup Files

**Prefer applying settings before the app launches over applying them mid-test.** `settings.set(...)` after the app is already running forces a window reload to take effect -- reloads are slow, and for settings that gate discovery/session behavior they can be flaky (a reload doesn't always re-run every startup code path a cold launch does). If the setting is known up front, write it via the `settingsFile` fixture inside a `beforeApp` worker fixture instead, so it's baked into the launch and there's no reload at all.

Check `test/e2e/tests/_test.setup.ts` for existing worker options first -- `useLegacyNotebookEditor`, `enableDataConnections`, `enableFoundryAssistant` are all already wired into its `beforeApp`. If one covers your setting, no custom setup file is needed at all -- just override it directly in your test file:

```typescript
import { test, expect, tags } from '../_test.setup';

test.use({ useLegacyNotebookEditor: true });
```

If several files in a feature directory need the same override, centralize it in a `_test.setup.ts` in that directory instead of repeating `test.use()` in every file -- see `test/e2e/tests/notebook/_test.setup.ts`:

```typescript
import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

export const test = base.extend<TestFixtures, WorkerFixtures>({
	useLegacyNotebookEditor: [true, { scope: 'worker' }],
});
```

Every file in that directory then imports `test` from `./_test.setup.js` instead of `../_test.setup` to pick up the override.

If no existing option covers your setting, define your own worker-scoped option and `beforeApp` override the same way base `_test.setup.ts` does -- inline in a single file if it's isolated, or in a directory `_test.setup.ts` if it applies to a whole feature area.

**Example: `test/e2e/tests/notebooks-positron/_test.setup.ts`** (a directory-wide, custom option)

```typescript
import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

interface NotebooksPositronTestFixtures extends TestFixtures { }
interface NotebooksPositronWorkerFixtures extends WorkerFixtures {
	enablePositronNotebooks: boolean;
	extraSettings: Record<string, unknown> | undefined;
}

export const test = base.extend<NotebooksPositronTestFixtures, NotebooksPositronWorkerFixtures>({
	enablePositronNotebooks: [true, { scope: 'worker', option: true }],
	extraSettings: [undefined, { scope: 'worker', option: true }],

	beforeApp: [
		async ({ enablePositronNotebooks, extraSettings, settingsFile }, use) => {
			if (enablePositronNotebooks) {
				await settingsFile.append({ 'positron.notebook.enabled': true });
			}
			if (extraSettings) {
				// Opt in per-suite with test.use({ extraSettings: { ... } })
				await settingsFile.append(extraSettings);
			}
			await use();
		},
		{ scope: 'worker' }
	],
});
```

Note this file does not re-export `expect`/`tags` -- import those from the base `_test.setup` directly if needed.

Use the local `_test.setup` when testing specific features:

```typescript
// For Positron notebook tests
import { test, expect, tags } from './_test.setup';

// For general tests
import { test, expect, tags } from '../_test.setup';
```

## Best Practices

- **Match fixture scope to purpose.** Worker-scoped fixtures (like `settings`) run once per file; test-scoped fixtures run fresh per test. See `references/common-mistakes.md` #5 for the settings-scope pitfall.
- **Prefer the `python`/`r` interpreter fixtures over a manual `sessions.start('python')`** when a test just needs a ready interpreter -- they auto-start it and wait for the console to be ready, saving a step and the ready-wait.
