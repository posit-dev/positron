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
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER, tags.PERFORMANCE]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
		await hotKeys.showSecondarySidebar();
	});

	test('Python - Verify data explorer functionality with XLSX input', async function ({ app, python, openFile, runCommand, hotKeys, metric }) {
		const { dataExplorer, variables, editors } = app.workbench;

		await openFile(join('workspaces', 'read-xlsx-py', 'supermarket-sales.py'));
		await runCommand('python.execInConsole');

		await metric.dataExplorer.loadData(async () => {
			await variables.doubleClickVariableRow('df');
			await editors.verifyTab('Data: df', { isVisible: true });
			await dataExplorer.waitForIdle();
		}, 'py.pandas.DataFrame');

		await hotKeys.closeSecondarySidebar();
		await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');
		const visibleTableData = await dataExplorer.grid.getData();
		const firstRow = visibleTableData.at(0);
		expect(firstRow!['Invoice ID']).toBe('898-04-2717');
	});

	test('R - Verify data explorer functionality with XLSX input', async function ({ app, r, openFile, runCommand, hotKeys, metric }) {
		const { dataExplorer, variables, editors } = app.workbench;

		await openFile(join('workspaces', 'read-xlsx-r', 'supermarket-sales.r'));
		await runCommand('r.sourceCurrentFile');

		await metric.dataExplorer.loadData(async () => {
			await variables.doubleClickVariableRow('df2');
			await editors.verifyTab('Data: df2', { isVisible: true });
			await dataExplorer.waitForIdle();
		}, 'r.tibble');

		await hotKeys.closeSecondarySidebar();
		await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');
		const visibleTableData = await dataExplorer.grid.getData();
		const firstRow = visibleTableData.at(0);
		expect(firstRow!['Invoice ID']).toBe('898-04-2717');
	});
});
