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
test('example', async function ({ app }) {
	// Access workbench page objects
	await app.workbench.console.executeCode('Python', 'x = 1');
	await app.workbench.variables.doubleClickVariableRow('x');

	// Access workspace path
	const workspacePath = app.workspacePathOrFolder;

	// Access page directly
	const page = app.code.driver.page;
});
```

### page (Test-scoped)

Shorthand for `app.code.driver.page`. Direct Playwright Page access.

```typescript
test('example', async function ({ page }) {
	// Direct locator access
	await page.getByLabel('Start Interpreter').click();
	await expect(page.getByText('Python')).toBeVisible();
});
```

### sessions (Test-scoped)

Session/interpreter management.

```typescript
test('example', async function ({ sessions }) {
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
test('Python test', async function ({ app, python }) {
	// Python interpreter already started
	// Console is ready with >>> prompt
	await app.workbench.console.executeCode('Python', 'print("hello")');
});
```

### r (Test-scoped)

Auto-starts R interpreter before test runs.

```typescript
test('R test', async function ({ app, r }) {
	// R interpreter already started
	// Console is ready with > prompt
	await app.workbench.console.executeCode('R', 'print("hello")');
});
```

## File Operation Fixtures

### openFile (Test-scoped)

Opens a file from the workspace.

```typescript
test('example', async function ({ openFile }) {
	// Path relative to qa-example-content
	await openFile('workspaces/basic-rmd-file/basicRmd.rmd');

	// With wait option
	await openFile('workspaces/test/file.py', true);  // Wait for focus
});
```

### openDataFile (Test-scoped)

Opens a data file (for data explorer).

```typescript
test('example', async function ({ openDataFile }) {
	await openDataFile('workspaces/large_r_notebook/spotify.ipynb');
});
```

### openFolder (Test-scoped)

Opens a folder.

```typescript
test('example', async function ({ openFolder }) {
	await openFolder('qa-example-content/workspaces/r_testing');
});
```

## Code Execution Fixtures

### executeCode (Test-scoped)

Execute code in the console.

```typescript
test('example', async function ({ executeCode }) {
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
test('example', async function ({ runCommand }) {
	// Run command
	await runCommand('workbench.action.files.save');

	// With options
	await runCommand('some.command', { keepOpen: true });
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
		reload: true,       // Reload window after setting
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

Direct settings file access. Use for settings that need to be set before app starts.

```typescript
test.beforeAll(async ({ settingsFile }) => {
	// Write settings directly to file
	await settingsFile.write({
		'positron.notebook.enabled': true
	});
});
```

### vsCodeSettings (Worker-scoped)

Access VS Code's settings file (separate from user data dir settings).

```typescript
test.beforeAll(async ({ vsCodeSettings }) => {
	await vsCodeSettings.write({ 'key': 'value' });
});
```

## Utility Fixtures

### hotKeys (Test-scoped)

Keyboard shortcuts and UI actions.

```typescript
test('example', async function ({ hotKeys }) {
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
	await hotKeys.showPrimarySidebar();
	await hotKeys.closePrimarySidebar();

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
test('example', async function ({ packages }) {
	// Install package
	await packages.manage('snowflake', 'install');

	// Uninstall package
	await packages.manage('renv', 'uninstall');
});
```

### cleanup (Test-scoped)

Test cleanup utilities.

```typescript
test.afterAll(async function ({ cleanup }) {
	// Remove files created during test
	await cleanup.removeTestFiles(['output.txt', 'generated.csv']);
});
```

### devTools (Test-scoped)

Opens DevTools before test.

```typescript
test('debug test', async function ({ devTools, app }) {
	// DevTools already open
	// Useful for debugging
});
```

### restartApp (Test-scoped)

Restarts the app before test runs.

```typescript
test('fresh app test', async function ({ restartApp: app }) {
	// App has been restarted
	// Fresh state
});
```

### metric (Test-scoped)

Record performance metrics.

```typescript
test('performance test', async function ({ metric, app }) {
	await metric.record('operation-name', async () => {
		// Operation to measure
		await app.workbench.console.executeCode('Python', code);
	});
});
```

### logger (Worker-scoped)

Logging utilities.

```typescript
test('example', async function ({ app, logger }) {
	logger.log('Starting test operation');
	await app.workbench.console.executeCode('Python', 'x = 1');
	logger.log('Operation completed');
});
```

## Docker Fixtures (Workbench/Remote only)

### runDockerCommand

Execute commands in Docker container. Only available in e2e-workbench and e2e-remote-ssh projects.

```typescript
test('docker test', async function ({ runDockerCommand }) {
	const result = await runDockerCommand('ls -la', 'List files');
	// result.stdout, result.stderr, result.exitCode
});
```

## Fixture Dependencies

Some fixtures depend on others:

```
app
 ├── page (derived from app.code.driver.page)
 ├── sessions (derived from app.workbench.sessions)
 ├── hotKeys (derived from app.workbench.hotKeys)
 ├── executeCode (uses app.workbench.console)
 └── openFile/openDataFile/openFolder (use app)

python, r → sessions → app
settings → app
settingsFile → userDataDir → options
```

## Custom Test Setup Files

Some test categories have their own `_test.setup.ts` that extends base fixtures:

**Example: `test/e2e/tests/notebooks-positron/_test.setup.ts`**

```typescript
import { test as base, expect, tags } from '../_test.setup';

// Extend base test with notebook-specific settings
export const test = base.extend({
	beforeApp: async ({ settingsFile }, use) => {
		// Enable Positron notebooks before app starts
		await settingsFile.write({
			'positron.notebook.enabled': true,
			'workbench.editorAssociations': {
				'*.ipynb': 'workbench.editor.positronNotebook'
			}
		});
		await use();
	}
});

export { expect, tags };
```

Use the local `_test.setup` when testing specific features:

```typescript
// For Positron notebook tests
import { test, expect, tags } from './_test.setup';

// For general tests
import { test, expect, tags } from '../_test.setup';
```

## Best Practices

### Use Appropriate Scope

```typescript
// Worker-scoped for expensive operations (app startup, settings)
test.beforeAll(async ({ settings }) => {
	await settings.set({ 'key': 'value' });
});

// Test-scoped for per-test setup
test.beforeEach(async function ({ app }) => {
	await app.workbench.layouts.enterLayout('stacked');
});
```

### Combine Related Fixtures

```typescript
test('complete workflow', async function ({ app, python, hotKeys, executeCode }) {
	await executeCode('Python', 'df = pd.DataFrame(...)');
	await app.workbench.variables.doubleClickVariableRow('df');
	await hotKeys.closeSecondarySidebar();
	await app.workbench.dataExplorer.grid.verifyTableData([...]);
});
```

### Use Interpreter Fixtures for Interpreter-Dependent Tests

```typescript
// Prefer this - interpreter auto-started
test('Python test', async function ({ app, python }) {
	// Ready to execute code
});

// Over this - manual start
test('Python test', async function ({ app, sessions }) {
	await sessions.start('python');  // Extra step
});
```
