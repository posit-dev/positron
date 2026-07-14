# Page Objects

UI interactions are wrapped in page objects, reached through `app.workbench.*`:

```typescript
test('example', async ({ app }) => {
	const { console, variables, dataExplorer } = app.workbench;
	await console.executeCode('Python', 'x = 1');
	await variables.doubleClickVariableRow('x');
});
```

This file is **not** a method catalog. Method names change, and a stale list
will point you at something that no longer exists, so grep the source for the
authoritative signatures (below). Any method named on this page is illustrative,
there to show an idiom or a gotcha; never copy a name from here without
confirming it in the source.

## Finding the Exact Source

`test/e2e/infra/workbench.ts` is the index: every `app.workbench.*` property is declared there as `readonly propName: TypeName`, with `TypeName` imported from its source file at the top of the same file. To find or verify a method:

1. Grep `workbench.ts` for the property to get its `TypeName`, e.g. `grep -n "readonly assistant" test/e2e/infra/workbench.ts`.
2. Grep the same file for that type's import to get the source path, e.g. `grep -n "import { Assistant }" test/e2e/infra/workbench.ts`.
3. Grep that source file for the method, e.g. `grep -n "async " test/e2e/pages/<file>.ts`.

## What `app.workbench` exposes

Roughly 49 page objects, including `console`, `variables`, `dataExplorer`, `plots`, `notebooks` / `notebooksPositron`, `sessions`, `hotKeys`, `contextMenu`, `editors`, `explorer`, `layouts`, `modals`, `toasts`, `quickaccess`, `quickInput`, `connections`, `help`, `terminal`, `viewer`, `userSettings`, `debug`, `scm`, `search`, `outline`, `output`, `problems`, `testExplorer`, `clipboard`, and `assistant`. Use the lookup above for any of them.

A few structural notes:

- `dataExplorer` has sub-objects (`grid`, `filters`, `summaryPanel`, `convertToCodeModal`, `editorActionBar`), all in `pages/dataExplorer.ts`.
- `notebooks` is shared (VS Code and Positron notebooks); Positron-only actions like `addCell` live on `notebooksPositron`.
- `hotKeys` is also exposed as the `hotKeys` fixture (see `references/fixtures.md`).

## Non-obvious gotchas

Behavioral surprises that grepping a signature won't reveal (illustrative; confirm against source):

- `dataExplorer.grid.sortColumnBy(1, 'Sort Ascending')` takes a column **index**, not a name.
- `variables.expectVariableToBe('x', '42')`: match the actual quote style (Python shows `'x'`, R shows `"x"`).
- `plots.nextPlotButton` / `previousPlotButton` are Locators, not `nextPlot()` methods.
- `notebooks.assertCellOutput('expected', 0)` is an assertion, not a getter; there is no `getCellOutput` / `waitForCellOutput`.
- `sessions.getActiveSessions()` is plural and returns an array.
- Most POM methods wrap their body in `test.step` internally, but some (`console.waitForReady`, `plots.waitForNoPlots`) don't; see `references/common-mistakes.md` #9 before adding an outer `test.step`.
