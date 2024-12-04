/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../../_test.setup';

const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';
const FILTER_PARAMS = ['distance', 'is equal to', '2586'];
const POST_FILTER_DATA_SUMMARY = 'Showing 8,204 rows (2.44% of 336,776 total)  19 columns';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Large Data Frame', {
	tag: ['@pr', '@web', '@win']
}, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.positronLayouts.enterLayout('stacked');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronDataExplorer.closeDataExplorer();
	});

	test('Python - Verifies data explorer functionality with large data frame [C557555]', async function ({ app, python, logger }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.positronVariables.doubleClickVariableRow('df');
			expect(await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText() === 'Data: df');
		}).toPass();

		await app.workbench.positronSideBar.closeSecondarySideBar();

		await expect(async () => {
			// Validate full grid by checking bottom right corner data
			await app.workbench.positronDataExplorer.clickLowerRightCorner();
			const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();
			const lastRow = tableData.at(-1);
			const lastHour = lastRow!['time_hour'];
			expect(lastHour).toBe(LAST_CELL_CONTENTS);
		}).toPass();

		await expect(async () => {
			// Filter data set
			await app.workbench.positronDataExplorer.clickUpperLeftCorner();
			await app.workbench.positronDataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);

			const statusBar = await app.workbench.positronDataExplorer.getDataExplorerStatusBar();
			expect(statusBar.textContent).toBe(POST_FILTER_DATA_SUMMARY);
		}).toPass();

	});

	test('R - Verifies data explorer functionality with large data frame [C557554]', {
		tag: ['@web', '@pr']
	}, async function ({ app, logger, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.positronVariables.doubleClickVariableRow('df2');
			expect(await app.code.driver.getLocator('.label-name:has-text("Data: df2")').innerText() === 'Data: df2');
		}).toPass();

		await app.workbench.positronSideBar.closeSecondarySideBar();

		await expect(async () => {
			// Validate full grid by checking bottom right corner data
			await app.workbench.positronDataExplorer.clickLowerRightCorner();
			const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();
			const lastRow = tableData.at(-1);
			const lastHour = lastRow!['time_hour'];
			expect(lastHour).toBe(LAST_CELL_CONTENTS);
		}).toPass();

		await expect(async () => {
			// Filter data set
			await app.workbench.positronDataExplorer.clickUpperLeftCorner();
			await app.workbench.positronDataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);
			const statusBar = await app.workbench.positronDataExplorer.getDataExplorerStatusBar();
			expect(statusBar.textContent).toBe(POST_FILTER_DATA_SUMMARY);
		}).toPass();

	});
});
