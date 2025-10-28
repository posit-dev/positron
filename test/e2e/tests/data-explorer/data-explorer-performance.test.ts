/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { MetricTargetType } from '../../utils/metrics/metric-base.js';

const testCases: {
	env: 'Python' | 'R' | 'DuckDB';
	data: string;
	varName: string;
	varType: MetricTargetType;
	preFilterSummary: RegExp;
	postFilterSummary: RegExp;
}[] = [
		{
			env: 'Python',
			data: 'nyc-flights-data-py/flights-data-frame.py',
			varName: 'df',
			varType: 'py.pandas.DataFrame',
			preFilterSummary: /336,776/,
			postFilterSummary: /Showing 1 rows/,
		},
		{
			env: 'R',
			data: 'nyc-flights-data-r/flights-data-frame.r',
			varName: 'df2',
			varType: 'r.tibble',
			preFilterSummary: /336,776/,
			postFilterSummary: /Showing 1 rows/,
		},
		{
			env: 'Python',
			data: 'nyc-flights-data-py/flights-5million.py',
			varName: 'df_5mil',
			varType: 'py.pandas.DataFrame',
			preFilterSummary: /5,051,640/,
			postFilterSummary: /Showing 15 rows/,
		},
		{
			env: 'R',
			data: 'nyc-flights-data-r/flights-5million.r',
			varName: 'df_5mil',
			varType: 'r.tibble',
			preFilterSummary: /5,051,640/,
			postFilterSummary: /Showing 15 rows/,
		}
	];

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Performance', { tag: [] }, () => {
	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.stackedLayout();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	testCases.forEach(testCase => {
		test(`${testCase.varType} - Record data load, basic filtering and sorting [${testCase.preFilterSummary.source} rows]`,
			{ tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER, tags.PERFORMANCE] },
			async function ({ app, openFile, runCommand, metric, sessions }) {
				const { dataExplorer, variables, editors } = app.workbench;
				await sessions.start(testCase.env === 'Python' ? 'python' : 'r');

				await openFile('workspaces/' + testCase.data);
				await runCommand(testCase.env === 'Python' ? 'python.execInConsole' : 'r.sourceCurrentFile');

				// Record data loading
				await metric.dataExplorer.loadData(async () => {
					await variables.doubleClickVariableRow(testCase.varName);
					await editors.verifyTab(`Data: ${testCase.varName}`, { isVisible: true, isSelected: true });
					await dataExplorer.waitForIdle();
				}, testCase.varType);

				// Verify the status bar text reflects the full data set
				await dataExplorer.expectStatusBarToHaveText(testCase.preFilterSummary);
				await dataExplorer.maximize(false);

				// Perform and record basic sorting
				await metric.dataExplorer.sort(async () => {
					await dataExplorer.grid.sortColumnBy(5, 'Sort Descending');
					await dataExplorer.waitForIdle();
				}, testCase.varType);
				await dataExplorer.editorActionBar.clickButton('Clear Column Sorting');

				// Verify full grid by checking data in the bottom right corner
				await dataExplorer.grid.clickLowerRightCorner();
				await dataExplorer.grid.expectCellContentAtIndexToBe('2013-09-30 08:00:00');

				// Perform and record basic filtering
				await dataExplorer.grid.clickUpperLeftCorner();
				await dataExplorer.filters.add({ columnName: 'tailnum', condition: 'is equal to', value: 'N532UA', metricRecord: metric, metricTargetType: testCase.varType });
				await dataExplorer.filters.add({ columnName: 'arr_delay', condition: 'is equal to', value: '-49' });
				await dataExplorer.expectStatusBarToHaveText(testCase.postFilterSummary);
			});
	});
});


