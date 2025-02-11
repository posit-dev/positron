/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - XLSX', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.dataExplorer.closeDataExplorer();
		await app.workbench.variables.toggleVariablesView();
	});

	test('Python - Verify data explorer functionality with XLSX input', async function ({ app, python, logger }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'read-xlsx-py', 'supermarket-sales.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df');
			await app.code.driver.page.locator('.label-name:has-text("Data: df")').innerText();
		}).toPass();

		await app.workbench.sideBar.closeSecondarySideBar();
		await app.workbench.dataExplorer.selectColumnMenuItem(1, 'Sort Descending');
		const visibleTableData = await app.workbench.dataExplorer.getDataExplorerTableData();
		const firstRow = visibleTableData.at(0);
		expect(firstRow!['Invoice ID']).toBe('898-04-2717');
	});

	test('R - Verify data explorer functionality with XLSX input', async function ({ app, r, logger }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'read-xlsx-r', 'supermarket-sales.r'));
		await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df2');
			await app.code.driver.page.locator('.label-name:has-text("Data: df2")').innerText();
		}).toPass();

		await app.workbench.sideBar.closeSecondarySideBar();
		await app.workbench.dataExplorer.selectColumnMenuItem(1, 'Sort Descending');
		const visibleTableData = await app.workbench.dataExplorer.getDataExplorerTableData();
		const firstRow = visibleTableData.at(0);
		expect(firstRow!['Invoice ID']).toBe('898-04-2717');
	});
});
