/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Python Polars', {
	tag: [tags.WIN, tags.WEB, tags.CRITICAL, tags.DATA_EXPLORER]
}, () => {

	test.beforeEach(async function ({ app, openFile, runCommand, python }) {
		const { variables, dataExplorer, editors } = app.workbench;

		await openFile(join('workspaces', 'polars-dataframe-py', 'polars_basic.py'));
		await runCommand('python.execInConsole');

		// open the data frame in the data explorer
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });
		await dataExplorer.maximize(false);
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await app.workbench.dataExplorer.filters.clearAll();
		await hotKeys.closeAllEditors();
	});

	test('Python Polars - Verify table data, copy to clipboard, sparkline hover, null percentage hover', async function ({ app }) {
		const { dataExplorer, clipboard } = app.workbench;

		// verify table data
		await dataExplorer.grid.verifyTableData([
			{ 'foo': '1', 'bar': '6.00', 'ham': '2020-01-02' },
			{ 'foo': '2', 'bar': '7.00', 'ham': '2021-03-04' },
			{ 'foo': '3', 'bar': '8.00', 'ham': '2022-05-06' }
		]);

		// verify can copy data to clipboard
		await dataExplorer.grid.clickCell(0, 0);
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('1');

		// verify sparkline hover
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.verifySparklineHoverDialog(['Range', 'Count']);

		// verify null percentage hover
		await dataExplorer.summaryPanel.verifyNullPercentHoverDialog();
	});


	test('Python Polars - Verify column info functionality: missing %s, profile data', async function ({ app }) {
		const { dataExplorer } = app.workbench;
		await dataExplorer.summaryPanel.show();

		// Verify all missing percentages
		await dataExplorer.summaryPanel.verifyMissingPercent([
			{ column: 1, expected: '0%' },
			{ column: 2, expected: '0%' },
			{ column: 3, expected: '0%' },
			{ column: 4, expected: '33%' },
			{ column: 5, expected: '33%' },
			{ column: 6, expected: '33%' }
		]);

		// Verify all column profile data
		await dataExplorer.summaryPanel.verifyColumnData([
			{ column: 1, expected: { 'Missing': '0', 'Min': '1', 'Median': '2.00', 'Mean': '2.00', 'Max': '3', 'SD': '1.00' } },
			{ column: 2, expected: { 'Missing': '0', 'Min': '6.00', 'Median': '7.00', 'Mean': '7.00', 'Max': '8.00', 'SD': '1.00' } },
			{ column: 3, expected: { 'Missing': '0', 'Min': '2020-01-02', 'Median': '2021-03-04', 'Max': '2022-05-06' } },
			{ column: 4, expected: { 'Missing': '1', 'Min': '2', 'Median': '2.50', 'Mean': '2.50', 'Max': '3', 'SD': '0.7071' } },
			{ column: 5, expected: { 'Missing': '1', 'Min': '0.5000', 'Median': '1.50', 'Mean': '1.50', 'Max': '2.50', 'SD': '1.41' } },
			{ column: 6, expected: { 'Missing': '1', 'True': '1', 'False': '1' } }
		]);
	});

	test('Python Polars - Verify can filter column', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// filter table by: foo is not equal to 1
		await dataExplorer.filters.add({ columnName: 'foo', condition: 'is not equal to', value: '1' });
		await dataExplorer.grid.verifyTableData([
			{ 'foo': '2', 'bar': '7.00', 'ham': '2021-03-04' },
			{ 'foo': '3', 'bar': '8.00', 'ham': '2022-05-06' }
		]);
	});

	test('Python Polars - Verify can sort column', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		// sort table by column 1 (foo): descending
		await dataExplorer.summaryPanel.show();
		await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');
		await dataExplorer.grid.verifyTableData([
			{ 'foo': '3', 'bar': '8.00', 'ham': '2022-05-06' },
			{ 'foo': '2', 'bar': '7.00', 'ham': '2021-03-04' },
			{ 'foo': '1', 'bar': '6.00', 'ham': '2020-01-02' }
		]);

		// clear sorting
		await dataExplorer.grid.sortColumnBy(1, 'Clear Sorting');
		await dataExplorer.grid.verifyTableData([
			{ 'foo': '1', 'bar': '6.00', 'ham': '2020-01-02' },
			{ 'foo': '2', 'bar': '7.00', 'ham': '2021-03-04' },
			{ 'foo': '3', 'bar': '8.00', 'ham': '2022-05-06' }
		]);
	});
});


