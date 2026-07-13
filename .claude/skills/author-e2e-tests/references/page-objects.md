# Page Objects

Documentation of page objects available via `app.workbench.*`.

**For the authoritative, always-current method list, read `references/generated/<pomName>.md`** (or `references/generated/index.md` for the full list of POMs). Those files are generated directly from `test/e2e/pages/*.ts` by `scripts/generate-pom-reference.ts` -- regenerate with `npm run e2e-gen-pom-reference` if any file under `test/e2e/pages/` is newer than the generated output. This page is a curated set of common usage idioms, not an exhaustive method list. Don't guess a method name from here -- check the generated reference first.

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

Full list: `references/generated/console.md`.

## Variables (`app.workbench.variables`)

```typescript
await variables.doubleClickVariableRow('df');   // Opens in data explorer
await variables.expandVariable('my_list');
await variables.expectVariableToBe('x', '42');  // Python shows 'x', R shows "x" -- match the actual quote style
await variables.expectVariableToNotExist('df');
```

Full list: `references/generated/variables.md`.

## Data Explorer (`app.workbench.dataExplorer`)

```typescript
await dataExplorer.grid.verifyTableData([{ 'Name': 'Alice', 'Age': '30' }]);
await dataExplorer.grid.sortColumnBy(1, 'Sort Ascending');   // Takes a column INDEX, not a name
await dataExplorer.filters.add({ columnName: 'Name', condition: 'contains', value: 'Alice' });
await dataExplorer.summaryPanel.show();
```

Sub-objects: `grid`, `filters`, `summaryPanel`, `convertToCodeModal`, `editorActionBar`. Full list: `references/generated/dataExplorer.md`.

## Plots (`app.workbench.plots`)

```typescript
await plots.waitForCurrentPlot();
await plots.expectPlotThumbnailsCountToBe(3);
await plots.nextPlotButton.click();   // A Locator, not a nextPlot() method
await plots.savePlotFromPlotsPane({ name: 'my-plot', format: 'PNG' });
```

Full list: `references/generated/plots.md`.

## Notebooks (`app.workbench.notebooks`)

Shared notebook operations (works with both VS Code and Positron notebooks). Positron-specific actions like `addCell` live on `app.workbench.notebooksPositron` instead.

```typescript
await notebooks.openNotebook(path);
await notebooks.selectInterpreter('Python', process.env.POSITRON_PY_VER_SEL!);
await notebooks.executeActiveCell();
await notebooks.runAllCells();
await notebooks.assertCellOutput('expected', 0);   // Assertion, not a getter -- no getCellOutput/waitForCellOutput
```

Full list: `references/generated/notebooks.md` (shared) and `references/generated/notebooksPositron.md` (Positron-specific).

## Sessions (`app.workbench.sessions`)

```typescript
await sessions.start('python');
await sessions.expectAllSessionsToBeReady();
const active = await sessions.getActiveSessions();   // Plural, returns an array
```

Full list: `references/generated/sessions.md`.

## HotKeys (`app.workbench.hotKeys`)

Also available as the `hotKeys` fixture -- see `references/fixtures.md`.

```typescript
await hotKeys.copy();
await hotKeys.closeAllEditors();
await hotKeys.stackedLayout();
```

Full list: `references/generated/hotKeys.md`.

## Context Menu (`app.workbench.contextMenu`)

```typescript
await contextMenu.triggerAndClick({ menuTrigger: someLocator, menuItemLabel: 'Menu Item' });
```

Full list: `references/generated/contextMenu.md`.

## Other Page Objects

See `references/generated/index.md` for the complete, generated list of all `app.workbench.*` properties (editors, explorer, layouts, modals, toasts, quickaccess, quickInput, connections, help, terminal, viewer, settings, debug, scm, search, outline, output, problems, testExplorer, clipboard, assistant, and more).

## Page Object Pattern

Most action/verification methods wrap their body in `test.step(...)`, but not all of them (e.g. `console.waitForReady`, `plots.waitForNoPlots` don't). Each entry in `references/generated/<pom>.md` states `(wraps in test.step: yes/no)` -- check it before adding an outer `test.step` around a call. Wrapping a call that already wraps itself produces a redundant nested step in the report (see `references/common-mistakes.md` #16).

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

## Finding Available Methods

1. Read `references/generated/<pomName>.md` for the exact signature (start from `references/generated/index.md` if you don't know the file name).
2. If it looks stale (a file under `test/e2e/pages/` is newer than the generated output), run `npm run e2e-gen-pom-reference` to refresh it.
3. For anything the generated reference doesn't answer -- parameter shapes it can't express, retry/wait internals -- read the source in `test/e2e/pages/` directly.
