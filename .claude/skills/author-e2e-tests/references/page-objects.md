# Page Objects

Documentation of page objects available via `app.workbench.*`.

**For the authoritative method list, read the POM's source file directly** (see "Finding the Exact Source" below). This page is a curated set of common usage idioms, not an exhaustive method list -- don't guess a method name from here.

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

```typescript
await console.executeCode('Python', 'print("hello")');
await console.executeCode('Python', code, { timeout: 60000, waitForReady: true, maximizeConsole: true });
await console.waitForConsoleContents('expected text');
await console.waitForReady('>>>');
```

Source: `test/e2e/pages/console.ts`.

## Variables (`app.workbench.variables`)

```typescript
await variables.doubleClickVariableRow('df');   // Opens in data explorer
await variables.expandVariable('my_list');
await variables.expectVariableToBe('x', '42');  // Python shows 'x', R shows "x" -- match the actual quote style
await variables.expectVariableToNotExist('df');
```

Source: `test/e2e/pages/variables.ts`.

## Data Explorer (`app.workbench.dataExplorer`)

```typescript
await dataExplorer.grid.verifyTableData([{ 'Name': 'Alice', 'Age': '30' }]);
await dataExplorer.grid.sortColumnBy(1, 'Sort Ascending');   // Takes a column INDEX, not a name
await dataExplorer.filters.add({ columnName: 'Name', condition: 'contains', value: 'Alice' });
await dataExplorer.summaryPanel.show();
```

Sub-objects: `grid`, `filters`, `summaryPanel`, `convertToCodeModal`, `editorActionBar` -- all in the same source file. Source: `test/e2e/pages/dataExplorer.ts`.

## Plots (`app.workbench.plots`)

```typescript
await plots.waitForCurrentPlot();
await plots.expectPlotThumbnailsCountToBe(3);
await plots.nextPlotButton.click();   // A Locator, not a nextPlot() method
await plots.savePlotFromPlotsPane({ name: 'my-plot', format: 'PNG' });
```

Source: `test/e2e/pages/plots.ts`.

## Notebooks (`app.workbench.notebooks`)

Shared notebook operations (works with both VS Code and Positron notebooks). Positron-specific actions like `addCell` live on `app.workbench.notebooksPositron` instead.

```typescript
await notebooks.openNotebook(path);
await notebooks.selectInterpreter('Python', process.env.POSITRON_PY_VER_SEL!);
await notebooks.executeActiveCell();
await notebooks.runAllCells();
await notebooks.assertCellOutput('expected', 0);   // Assertion, not a getter -- no getCellOutput/waitForCellOutput
```

Source: `test/e2e/pages/notebooks.ts` (shared) and `test/e2e/pages/notebooksPositron.ts` (Positron-specific).

## Sessions (`app.workbench.sessions`)

```typescript
await sessions.start('python');
await sessions.expectAllSessionsToBeReady();
const active = await sessions.getActiveSessions();   // Plural, returns an array
```

Source: `test/e2e/pages/sessions.ts`.

## HotKeys (`app.workbench.hotKeys`)

Also available as the `hotKeys` fixture -- see `references/fixtures.md`.

```typescript
await hotKeys.copy();
await hotKeys.closeAllEditors();
await hotKeys.stackedLayout();
```

Source: `test/e2e/pages/hotKeys.ts`.

## Context Menu (`app.workbench.contextMenu`)

```typescript
await contextMenu.triggerAndClick({ menuTrigger: someLocator, menuItemLabel: 'Menu Item' });
```

Source: `test/e2e/pages/dialog-contextMenu.ts`.

## Other Page Objects

`app.workbench.*` has ~49 properties total (editors, explorer, layouts, modals, toasts, quickaccess, quickInput, connections, help, terminal, viewer, settings, debug, scm, search, outline, output, problems, testExplorer, clipboard, assistant, and more). See "Finding the Exact Source" below to look up any of them.

## Page Object Pattern

Most action/verification methods wrap their body in `test.step(...)`, but not all of them (e.g. `console.waitForReady`, `plots.waitForNoPlots` don't). Before adding an outer `test.step` around a POM call, check whether it already wraps itself -- see `references/common-mistakes.md` #16 for how, and why double-wrapping is a problem.

```typescript
export class MyPageObject {
	someButton: Locator;

	constructor(private code: Code, ...) {
		this.someButton = this.code.driver.currentPage.getByTestId('some-button');
	}

	// Actions/verifications are typically wrapped in test.step for report readability
	async doSomething(): Promise<void> {
		return test.step('Do something', async () => {
			await this.someButton.click();
		});
	}
}
```

## Finding the Exact Source

`test/e2e/infra/workbench.ts` is the index: every `app.workbench.*` property is declared there as `readonly propName: TypeName`, with `TypeName` imported from its source file right at the top of the same file. To find or verify a method:

1. Grep `workbench.ts` for the property name, e.g. `grep -n "readonly assistant" test/e2e/infra/workbench.ts` -- note the `TypeName`.
2. Grep the same file for that `TypeName`'s import, e.g. `grep -n "import { Assistant }" test/e2e/infra/workbench.ts` -- that's the source path.
3. Read or grep that file directly (e.g. `grep -n "async " test/e2e/pages/<file>.ts`) for the exact method signature.

Never guess or paraphrase a method name from this skill's prose -- copy it from the source file.
