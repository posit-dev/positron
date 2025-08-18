/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';
const FILTER_PARAMS = ['distance', 'is equal to', '2586'];
const POST_FILTER_DATA_SUMMARY = 'Showing 8,204 rows (2.44% of 336,776 total)  19 columns';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Large Data Frame', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {
	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.stackedLayout();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Verify data loads and basic filtering with large data frame', async function ({ app, openFile, runCommand, python }) {
		const { dataExplorer, variables, editors } = app.workbench;
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await runCommand('python.execInConsole');

		// Open Data Explorer for the data frame
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });

		// Validate full grid by checking data in the bottom right corner
		await dataExplorer.grid.clickLowerRightCorner();
		await dataExplorer.grid.expectLastCellContentToBe('time_hour', LAST_CELL_CONTENTS);

		// Verify the status bar text reflects the full data set
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.filters.add(...FILTER_PARAMS as [string, string, string]);
		await dataExplorer.expectStatusBarToHaveText(POST_FILTER_DATA_SUMMARY);
	});

	test('R - Verify data loads and basic filtering with large data frame', {
		tag: [tags.WEB, tags.CRITICAL]
	}, async function ({ app, openFile, runCommand, r }) {
		const { dataExplorer, variables, editors } = app.workbench;

		await openFile(join('workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await runCommand('r.sourceCurrentFile');

		// Open Data Explorer for the data frame
		await variables.doubleClickVariableRow('df2');
		await editors.verifyTab('Data: df2', { isVisible: true, isSelected: true });

		// Validate full grid by checking data in the bottom right corner
		await dataExplorer.grid.clickLowerRightCorner();
		await dataExplorer.grid.expectLastCellContentToBe('time_hour', LAST_CELL_CONTENTS);

		// Verify the status bar text reflects the full data set
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.filters.add(...FILTER_PARAMS as [string, string, string]);
		await dataExplorer.expectStatusBarToHaveText(POST_FILTER_DATA_SUMMARY);
	});
});



