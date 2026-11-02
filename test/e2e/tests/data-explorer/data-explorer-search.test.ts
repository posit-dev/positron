/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Search All Columns', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		await app.workbench.dataExplorer.filters.clearAll();
		await hotKeys.closeAllEditors();
	});

	test('Python Pandas - Search text and numbers, stack with a filter, and clear', {
		tag: [tags.PYTHON]
	}, async function ({ app, executeCode, hotKeys, python }) {
		const { dataExplorer, variables, editors } = app.workbench;

		await executeCode('Python', searchScript);
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });
		await dataExplorer.maximize(false);

		// A text term matches any column, case-insensitively.
		await dataExplorer.search.type('pine');
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+2\s+rows\s+\(50\.00%\s+of\s+4\s+total\)\s+3\s+columns\s+"pine"/);
		await dataExplorer.search.expectMatchedCellsToBe(['Pinewood', 'apple pine']);

		// A numeric term matches numbers at its precision.
		await dataExplorer.search.type('3.1');
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+1\s+rows/);
		await dataExplorer.search.expectMatchedCellsToBe(['3.14']);

		// The search stacks with a column filter.
		await dataExplorer.search.type('a');
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+2\s+rows/);
		await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than', value: '3' });
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+1\s+rows/);

		// Clearing from the status bar keeps the column filter.
		await dataExplorer.search.clearFromStatusBar();
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+2\s+rows/);
		await expect(dataExplorer.search.input).toHaveValue('');

		// Cmd/Ctrl+F focuses the search box from the grid.
		await dataExplorer.grid.clickCell(0, 0);
		await hotKeys.find();
		await expect(dataExplorer.search.input).toBeFocused();
	});

	test('R - Search text and numbers, stack with a filter, and clear', {
		tag: [tags.ARK]
	}, async function ({ app, executeCode, r }) {
		const { dataExplorer, variables, editors } = app.workbench;

		await executeCode('R', rSearchScript);
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });
		await dataExplorer.maximize(false);

		await dataExplorer.search.type('pine');
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+2\s+rows\s+\(50\.00%\s+of\s+4\s+total\)\s+3\s+columns\s+"pine"/);
		await dataExplorer.search.expectMatchedCellsToBe(['Pinewood', 'apple pine']);

		await dataExplorer.search.type('3.1');
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+1\s+rows/);
		await dataExplorer.search.expectMatchedCellsToBe(['3.14']);

		await dataExplorer.search.type('a');
		await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than', value: '3' });
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+1\s+rows/);

		await dataExplorer.search.clear();
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+2\s+rows/);
	});

	test('DuckDB - Search a data file and clear', {
		tag: [tags.DUCK_DB]
	}, async function ({ app, openDataFile }) {
		const { dataExplorer } = app.workbench;

		await openDataFile('data-files/100x100/100x100.parquet');
		await dataExplorer.expectStatusBarToHaveText(/^100\s+rows/);

		await dataExplorer.search.type('no such value anywhere');
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+0\s+rows/);

		await dataExplorer.search.clear();
		await dataExplorer.expectStatusBarToHaveText(/^100\s+rows/);
	});
});

const searchScript = `import pandas as pd
df = pd.DataFrame({'name': ['Pinewood', 'Oak', 'Maple', 'Birch'], 'score': [3.14, 2.5, 7.0, 1.0], 'note': ['x', 'apple pine', 'tall', 'y']})`;

const rSearchScript = `df <- data.frame(name = c('Pinewood', 'Oak', 'Maple', 'Birch'), score = c(3.14, 2.5, 7.0, 1.0), note = c('x', 'apple pine', 'tall', 'y'))`;
