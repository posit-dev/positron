/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';
const FILTER_PARAMS = ['distance', 'is equal to', '2586'];
const POST_FILTER_DATA_SUMMARY = 'Showing 8,204 rows (2.44% of 336,776 total)  19 columns';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Large Data Frame', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('stacked');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.dataExplorer.closeDataExplorer();
	});

	test('Python - Verifies data explorer functionality with large data frame', async function ({ app, python, logger }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df');
			expect(await app.code.driver.page.locator('.label-name:has-text("Data: df")').innerText() === 'Data: df');
		}).toPass();

		await app.workbench.sideBar.closeSecondarySideBar();

		await expect(async () => {
			// Validate full grid by checking bottom right corner data
			await app.workbench.dataExplorer.clickLowerRightCorner();
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
			const lastRow = tableData.at(-1);
			const lastHour = lastRow!['time_hour'];
			expect(lastHour).toBe(LAST_CELL_CONTENTS);
		}).toPass();

		await expect(async () => {
			// Filter data set
			await app.workbench.dataExplorer.clickUpperLeftCorner();
			await app.workbench.dataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);

			const statusBarText = await app.workbench.dataExplorer.getDataExplorerStatusBarText();
			expect(statusBarText).toBe(POST_FILTER_DATA_SUMMARY);
		}).toPass();

	});

	test('R - Verifies data explorer functionality with large data frame', {
		tag: [tags.WEB, tags.CRITICAL]
	}, async function ({ app, logger, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df2');
			expect(await app.code.driver.page.locator('.label-name:has-text("Data: df2")').innerText() === 'Data: df2');
		}).toPass();

		await app.workbench.sideBar.closeSecondarySideBar();

		await expect(async () => {
			// Validate full grid by checking bottom right corner data
			await app.workbench.dataExplorer.clickLowerRightCorner();
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
			const lastRow = tableData.at(-1);
			const lastHour = lastRow!['time_hour'];
			expect(lastHour).toBe(LAST_CELL_CONTENTS);
		}).toPass();

		await expect(async () => {
			// Filter data set
			await app.workbench.dataExplorer.clickUpperLeftCorner();
			await app.workbench.dataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);
			const statusBarText = await app.workbench.dataExplorer.getDataExplorerStatusBarText();
			expect(statusBarText).toBe(POST_FILTER_DATA_SUMMARY);
		}).toPass();

	});
});
