/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';
import { MetricTargetType } from '../../../utils/metrics/metric-base.js';
import { TestTags } from '../../../infra/index.js';

// Every test case is the nycflights13 flights table (the 5M-row cases repeat it), so the same cells
// mark a finished sort and filter.
const SORT_COLUMN_INDEX = 4; // sched_dep_time
const SORTED_TOP_VALUE = '2359';
const TAILNUM_COLUMN_INDEX = 11;

const testCases: {
	env: 'Python' | 'R' | 'DuckDB';
	data: string;
	varName: string;
	varType: MetricTargetType;
	preFilterSummary: RegExp;
	postFilterSummary: RegExp;
	tags?: TestTags[];
}[] = [
		{
			env: 'Python',
			data: 'nyc-flights-data-py/flights-data-frame.py',
			varName: 'df',
			varType: 'py.pandas.DataFrame',
			preFilterSummary: /336,776/,
			postFilterSummary: /Showing 1 rows/,
			tags: [tags.PYTHON],
		},
		{
			env: 'R',
			data: 'nyc-flights-data-r/flights-data-frame.r',
			varName: 'df2',
			varType: 'r.tibble',
			preFilterSummary: /336,776/,
			postFilterSummary: /Showing 1 rows/,
			tags: [tags.ARK],
		},
		{
			env: 'Python',
			data: 'nyc-flights-data-py/flights-5million.py',
			varName: 'df_5mil',
			varType: 'py.pandas.DataFrame',
			preFilterSummary: /5,051,640/,
			postFilterSummary: /Showing 15 rows/,
			tags: [tags.PYTHON],
		},
		{
			env: 'R',
			data: 'nyc-flights-data-r/flights-5million.r',
			varName: 'df_5mil',
			varType: 'r.tibble',
			preFilterSummary: /5,051,640/,
			postFilterSummary: /Showing 15 rows/,
			tags: [tags.ARK]
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
			{ tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER, tags.PERFORMANCE, ...(testCase.tags || [])] },
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

				// Sort and filter time how long the user waits to see the result in the grid. They wait
				// for idle first so they don't absorb work started by an earlier step, and don't wait for
				// idle inside the timer because idle also covers background column-summary requests.
				await dataExplorer.waitForIdle();

				// Perform and record basic sorting
				await metric.dataExplorer.sort(async () => {
					await dataExplorer.grid.sortColumnBy(5, 'Sort Descending');
					await dataExplorer.grid.waitForCellText({ rowIndex: 0, colIndex: SORT_COLUMN_INDEX, value: SORTED_TOP_VALUE });
				}, testCase.varType);
				await dataExplorer.waitForIdle();
				await dataExplorer.editorActionBar.clickButton('Clear Column Sorting');

				// Verify full grid by checking data in the bottom right corner
				await dataExplorer.grid.clickLowerRightCorner();
				await dataExplorer.grid.expectCellContentAtIndexToBe('2013-09-30 08:00:00');

				// Perform and record basic filtering
				await dataExplorer.grid.clickUpperLeftCorner();
				// The filter timer reads the tailnum cell, which isn't rendered while it's off-screen.
				await dataExplorer.grid.scrollToColumn(TAILNUM_COLUMN_INDEX);
				await dataExplorer.waitForIdle();
				await dataExplorer.filters.add({
					columnName: 'tailnum', condition: 'is equal to', value: 'N532UA', metricRecord: metric, metricTargetType: testCase.varType,
					metricDone: () => dataExplorer.grid.waitForCellText({ rowIndex: 0, colIndex: TAILNUM_COLUMN_INDEX, value: 'N532UA' })
				});
				await dataExplorer.filters.add({ columnName: 'arr_delay', condition: 'is equal to', value: '-49' });
				await dataExplorer.expectStatusBarToHaveText(testCase.postFilterSummary);
			});
	});
});


