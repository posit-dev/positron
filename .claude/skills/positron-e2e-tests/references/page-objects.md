# Page Objects

Complete documentation of page objects available via `app.workbench.*`.

## Page Object Architecture

Page objects encapsulate UI interactions. Access them through the `app.workbench` property:

```typescript
test('example', async function ({ app }) {
	const { console, variables, dataExplorer, plots } = app.workbench;

	await console.executeCode('Python', 'x = 1');
	await variables.doubleClickVariableRow('x');
});
```

## Console (`app.workbench.console`)

REPL/Console interactions.

### Key Methods

```typescript
// Execute code (opens quick input, selects language, runs code)
await console.executeCode('Python', 'print("hello")');
await console.executeCode('R', 'print("world")');
await console.executeCode('Python', code, {
	timeout: 60000,      // Wait timeout
	waitForReady: true,  // Wait for prompt after execution
	maximizeConsole: true // Maximize console panel
});

// Type directly to console
await console.typeToConsole('x = 1');
await console.typeToConsole('x = 1', true);  // Press enter after

// Paste code to console
await console.pasteCodeToConsole('multi\nline\ncode');
await console.pasteCodeToConsole('code', true);  // Press enter after

// Wait for ready state
await console.waitForReady('>>>');  // Python prompt
await console.waitForReady('>');    // R prompt
await console.waitForReady('>>>', 30000);  // With timeout

// Wait for content
await console.waitForConsoleContents('expected text');
await console.waitForConsoleContents(/regex pattern/);
await console.waitForConsoleContents('text', { timeout: 30000 });
await console.waitForConsoleContents('text', { expectedCount: 2 });
await console.waitForConsoleContents('should not appear', { expectedCount: 0 });

// Wait for execution states
await console.waitForExecutionStarted();
await console.waitForExecutionComplete();

// Actions
await console.sendEnterKey();
await console.clearInput();
await console.sendInterrupt();
await console.interruptExecution();
await console.focus();
await console.maximizeConsole();

// Session buttons
await console.restartButton.click();
await console.clearButton.click();
await console.trashButton.click();
```

### Locators

```typescript
console.activeConsole      // The active console instance
console.suggestionList     // Autocomplete suggestions
console.emptyConsole       // Empty console message
```

## Variables (`app.workbench.variables`)

Variables pane interactions.

```typescript
// Click/select variable
await variables.clickVariableRow('df');
await variables.doubleClickVariableRow('df');  // Opens in data explorer

// Expand/collapse
await variables.expandVariable('my_list');
await variables.collapseVariable('my_list');

// Get data
const value = await variables.getVariableValue('x');
await variables.waitForVariableValue('x', 'expected_value');

// Verify variable exists
await variables.waitForVariable('df');
await variables.verifyVariableExists('df', { timeout: 15000 });
```

## Data Explorer (`app.workbench.dataExplorer`)

Data viewer interactions.

### Grid Operations (`dataExplorer.grid`)

```typescript
// Click cells
await dataExplorer.grid.clickCell(0, 0);  // Row 0, Column 0
await dataExplorer.grid.clickCell(0, 0, true);  // With Shift

// Get data
const cellValue = await dataExplorer.grid.getCellValue(0, 0);
const tableData = await dataExplorer.grid.getData();

// Verify data
await dataExplorer.grid.verifyTableData([
	{ 'Name': 'Alice', 'Age': '30' },
	{ 'Name': 'Bob', 'Age': '25' }
]);
await dataExplorer.grid.verifyTableData(expected, 60000);  // With timeout

// Column operations
await dataExplorer.grid.clickColumnHeader('Name');
await dataExplorer.grid.sortByColumn('Age', 'ascending');
await dataExplorer.grid.sortByColumn('Age', 'descending');
```

### Filters (`dataExplorer.filters`)

```typescript
// Add filter
await dataExplorer.filters.addTextFilter('Name', 'contains', 'Alice');
await dataExplorer.filters.addNumericFilter('Age', 'greater than', 25);

// Clear filters
await dataExplorer.filters.clearAll();
await dataExplorer.filters.removeFilter('Name');
```

### Summary Panel (`dataExplorer.summaryPanel`)

```typescript
await dataExplorer.summaryPanel.open();
await dataExplorer.summaryPanel.close();
await dataExplorer.summaryPanel.verifyColumnStats('Age', { mean: 27.5 });
```

## Plots (`app.workbench.plots`)

Plots pane interactions.

```typescript
// Wait for plot
await plots.waitForCurrentPlot();
await plots.waitForCurrentPlot({ timeout: 30000 });
await plots.waitForNoPlots();
await plots.waitForNoPlots({ timeout: 5000 });

// Plot count
await plots.waitForPlotCount(3);
const count = await plots.getPlotCount();

// Navigation
await plots.nextPlot();
await plots.previousPlot();
await plots.goToPlot(2);

// Actions
await plots.savePlotFromPlotsPane({ name: 'my-plot', format: 'PNG' });
await plots.savePlotFromPlotsPane({ name: 'plot', format: 'JPEG' });
await plots.copyCurrentPlotToClipboard();
await plots.openPlotIn('editor');
await plots.openPlotIn('newWindow');

// Editor operations
await plots.waitForPlotInEditor();
await plots.savePlotFromEditor({ name: 'editor-plot', format: 'PNG' });
```

## Notebooks (`app.workbench.notebooks`)

Shared notebook operations (works with both VS Code and Positron notebooks).

```typescript
// Open notebook
await notebooks.openNotebook(path);
await notebooks.openNotebook(join(app.workspacePathOrFolder, 'workspaces', 'notebook.ipynb'));

// Select interpreter
await notebooks.selectInterpreter('Python', process.env.POSITRON_PY_VER_SEL!);
await notebooks.selectInterpreter('R', process.env.POSITRON_R_VER_SEL!);

// Cell selection
await notebooks.selectCellAtIndex(0);
await notebooks.clickCell(0);

// Execution
await notebooks.executeActiveCell();
await notebooks.executeAllCells();
await notebooks.runAllCells();

// Cell content
await notebooks.addCell('code', 'print("hello")');
await notebooks.addCell('markdown', '# Header');
await notebooks.editCell(0, 'new code');

// Output
const output = await notebooks.getCellOutput(0);
await notebooks.waitForCellOutput(0, 'expected');

// Navigation
await notebooks.scrollToCell(5);
```

## Sessions (`app.workbench.sessions`)

Session management.

```typescript
// Start sessions
await sessions.start('python');
await sessions.start('r');
await sessions.start('python', { reuse: true });

// Wait for ready
await sessions.expectAllSessionsToBeReady();
await sessions.expectAllSessionsToBeReady({ timeout: 30000 });
await sessions.expectStatusToBe('session-id', 'idle');
await sessions.expectNoStartUpMessaging();

// Session info
const activeSession = await sessions.getActiveSession();
const allSessions = await sessions.getAllSessions();
```

## Quick Access (`app.workbench.quickaccess`)

Command palette and quick access operations.

```typescript
// Run commands
await quickaccess.runCommand('workbench.action.files.save');
await quickaccess.runCommand('command.id', { keepOpen: true });
await quickaccess.runCommand('command.id', { exactMatch: true });

// Quick open
await quickaccess.openFile('file.py');
await quickaccess.openFileQuickAccessAndWait('file.py');
```

## Quick Input (`app.workbench.quickInput`)

Quick input dialog interactions.

```typescript
// Wait for open/close
await quickInput.waitForQuickInputOpened();
await quickInput.waitForQuickInputClosed();

// Type and select
await quickInput.type('search text');
await quickInput.selectQuickInputElement(0);
await quickInput.waitForQuickInputElements(elements => elements.length > 0);

// Close
await quickInput.closeQuickInput();
```

## Editors (`app.workbench.editors`)

Editor/tab management.

```typescript
// Verify tabs
await editors.verifyTab('Data: df', { isVisible: true });
await editors.verifyTab('file.py', { isActive: true });
await editors.verifyTabCount(3);

// Tab actions
await editors.selectTab('file.py');
await editors.closeTab('file.py');
await editors.closeAllTabs();
```

## Explorer (`app.workbench.explorer`)

File explorer interactions.

```typescript
// Navigate
await explorer.openFile('src/main.py');
await explorer.expandFolder('src');
await explorer.collapseFolder('src');

// Verify files
await explorer.verifyExplorerFilesExist(['file1.py', 'file2.py']);
await explorer.waitForFile('output.txt');
```

## Layouts (`app.workbench.layouts`)

Layout management.

```typescript
// Predefined layouts
await layouts.enterLayout('stacked');
await layouts.enterLayout('fullSizedPanel');
await layouts.enterLayout('fullSizedAuxBar');
await layouts.enterLayout('notebook');
```

## HotKeys (`app.workbench.hotKeys`)

Keyboard shortcuts. Also available as `hotKeys` fixture - see `references/fixtures.md`.

**Standard:** `copy()`, `paste()`, `selectAll()`
**Editor:** `closeAllEditors()`, `closeCurrentEditor()`
**Layout:** `stackedLayout()`, `notebookLayout()`, `fullSizeSecondarySidebar()`
**Sidebar:** `showSecondarySidebar()`, `closeSecondarySidebar()`, `showPrimarySidebar()`, `closePrimarySidebar()`
**Panel:** `toggleBottomPanel()`, `focusConsole()`
**Execution:** `sendInterrupt()`
**Plots:** `clearPlots()`

## Modals (`app.workbench.modals`)

Modal dialog interactions.

```typescript
await modals.waitForModalToOpen();
await modals.waitForModalToClose();
await modals.clickButton('OK');
await modals.clickButton('Cancel');
```

## Toasts (`app.workbench.toasts`)

Toast notification interactions.

```typescript
await toasts.waitForToast('Success message');
await toasts.dismissToast();
await toasts.verifyNoToasts();
```

## Context Menu (`app.workbench.contextMenu`)

Context menu interactions.

```typescript
await contextMenu.triggerAndClick({
	menuTrigger: someLocator,
	menuItemLabel: 'Menu Item'
});

await contextMenu.triggerAndVerifyMenuItems({
	menuTrigger: someLocator,
	menuItemStates: [
		{ label: 'Item 1', enabled: true },
		{ label: 'Item 2', enabled: false }
	]
});
```

## Other Page Objects

| Page Object | Access | Purpose |
|-------------|--------|---------|
| `connections` | `app.workbench.connections` | Database connections |
| `help` | `app.workbench.help` | Help pane |
| `terminal` | `app.workbench.terminal` | Terminal interactions |
| `viewer` | `app.workbench.viewer` | Viewer pane |
| `topActionBar` | `app.workbench.topActionBar` | Top action bar |
| `editorActionBar` | `app.workbench.editorActionBar` | Editor action bar |
| `sideBar` | `app.workbench.sideBar` | Side bar |
| `extensions` | `app.workbench.extensions` | Extensions |
| `settings` | `app.workbench.settings` | Settings UI |
| `debug` | `app.workbench.debug` | Debugger |
| `scm` | `app.workbench.scm` | Source control |
| `search` | `app.workbench.search` | Search |
| `outline` | `app.workbench.outline` | Outline view |
| `output` | `app.workbench.output` | Output pane |
| `problems` | `app.workbench.problems` | Problems pane |
| `testExplorer` | `app.workbench.testExplorer` | Test explorer |
| `clipboard` | `app.workbench.clipboard` | Clipboard |
| `assistant` | `app.workbench.assistant` | Positron Assistant |

## Page Object Pattern

All page objects follow this pattern:

```typescript
export class MyPageObject {
	// Locators as class properties
	someButton: Locator;
	someList: Locator;

	constructor(private code: Code, ...) {
		// Initialize locators in constructor
		this.someButton = this.code.driver.page.getByTestId('some-button');
		this.someList = this.code.driver.page.locator('.some-list');
	}

	// Actions wrapped in test.step
	async doSomething(): Promise<void> {
		return test.step('Do something', async () => {
			await this.someButton.click();
		});
	}

	// Verifications with expect
	async verifySomething(expected: string): Promise<void> {
		await test.step(`Verify something is ${expected}`, async () => {
			await expect(this.someList).toContainText(expected);
		});
	}
}
```

## Finding Available Methods

Check source files in `test/e2e/pages/` or use IDE autocomplete on `app.workbench.<pageObject>.`
