/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app, runCommand }) {
	await app.workbench.layouts.enterLayout('stacked');
	await app.workbench.variables.focusVariablesView();
});

test.afterEach(async function ({ runCommand }) {
	await runCommand('workbench.action.closeAllEditors');
});

test.describe('Data Explorer - R ', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {
	test('R - Verify basic data explorer functionality', { tag: [tags.CRITICAL] }, async function ({ app, r, openFile, runCommand }) {
		// Execute code to generate data frames
		await openFile('workspaces/generate-data-frames-r/simple-data-frames.r');
		await app.workbench.editor.playButton.click();

		// Open Data Explorer
		await app.workbench.variables.doubleClickVariableRow('df');
		await app.workbench.dataExplorer.verifyTab('Data: df', { isVisible: true, isSelected: true });

		// Verify the data in the table
		await app.workbench.dataExplorer.maximizeDataExplorer(true);
		await verifyTable(app);

		// Verify the summary column data
		await app.workbench.dataExplorer.expandSummary();
		await verifyColumnData(app);
	});

	test('R - Verify opening Data Explorer for the second time brings focus back', {
		annotation: [{
			type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5714'
		}, {
			type: 'regression', description: 'https://github.com/posit-dev/positron/issues/4197'
		}]
	}, async function ({ app, r, runCommand, executeCode }) {
		// Execute code to generate data frames
		await executeCode('R', `Data_Frame <- mtcars`);
		await app.workbench.variables.focusVariablesView();

		// Open Data Explorer
		await app.workbench.variables.doubleClickVariableRow('Data_Frame');
		await app.workbench.dataExplorer.verifyTab('Data: Data_Frame', { isVisible: true, isSelected: true });

		// Now move focus out of the the data explorer pane
		await app.workbench.editors.newUntitledFile();
		await app.workbench.variables.focusVariablesView();
		await app.workbench.dataExplorer.verifyTab('Data: Data_Frame', { isVisible: true, isSelected: false });
		await app.workbench.variables.doubleClickVariableRow('Data_Frame');
		await app.workbench.dataExplorer.verifyTab('Data: Data_Frame', { isVisible: true, isSelected: true });
	});

	test('R - Verify blank spaces in data explorer', async function ({ app, r, executeCode }) {
		// Execute code to generate data frames
		await executeCode('R', `df = data.frame(x = c("a ", "a", "   ", ""))`);

		// Open Data Explorer
		await app.workbench.variables.doubleClickVariableRow('df');
		await app.workbench.dataExplorer.verifyTab('Data: df', { isVisible: true, isSelected: true });

		// Verify blank spaces in the table
		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

			const expectedData = [
				{ 'x': 'a·' },
				{ 'x': 'a' },
				{ 'x': '···' },
				{ 'x': '<empty>' },
			];

			expect(tableData).toStrictEqual(expectedData);
			expect(tableData).toHaveLength(4);
		}).toPass({ timeout: 60000 });
	});
});

// Helpers

async function verifyTable(app: Application) {
	await test.step('Verify table data', async () => {
		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

			const expectedData = [
				{ 'Training': 'Strength', 'Pulse': '100.00', 'Duration': '60.00', 'Note': 'NA' },
				{ 'Training': 'Stamina', 'Pulse': 'NA', 'Duration': '30.00', 'Note': 'NA' },
				{ 'Training': 'Other', 'Pulse': '120.00', 'Duration': '45.00', 'Note': 'Note' },
			];

			expect(tableData).toStrictEqual(expectedData);
			expect(tableData).toHaveLength(3);
		}).toPass({ timeout: 60000 });
	});
}

async function verifyColumnData(app: Application) {
	await test.step('Verify column data', async () => {
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(1)).toBe('0%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(2)).toBe('33%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(3)).toBe('0%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(4)).toBe('66%');

		const col1ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(1);
		expect(col1ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Empty': '0', 'Unique': '3' });

		const col2ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(2);
		expect(col2ProfileInfo.profileData).toStrictEqual({ 'Missing': '1', 'Min': '100.00', 'Median': '110.00', 'Mean': '110.00', 'Max': '120.00', 'SD': '14.14' });

		const col3ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(3);
		expect(col3ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Min': '30.00', 'Median': '45.00', 'Mean': '45.00', 'Max': '60.00', 'SD': '15.00' });

		const col4ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(4);
		expect(col4ProfileInfo.profileData).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '2' });
	});
}
