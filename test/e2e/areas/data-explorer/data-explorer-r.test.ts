/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - R ', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {
	test('R - Verifies basic data explorer functionality [C609620]', { tag: [tags.CRITICAL] }, async function ({ app, r, logger }) {
		// snippet from https://www.w3schools.com/r/r_data_frames.asp
		const script = `Data_Frame <- data.frame (
	Training = c("Strength", "Stamina", "Other"),
	Pulse = c(100, NA, 120),
	Duration = c(60, 30, 45),
	Note = c(NA, NA, "Note")
)`;

		logger.log('Sending code to console');
		await app.workbench.positronConsole.executeCode('R', script, '>');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.positronVariables.doubleClickVariableRow('Data_Frame');
			await app.code.driver.page.locator('.label-name:has-text("Data: Data_Frame")').innerText();
		}).toPass();

		await app.workbench.positronDataExplorer.maximizeDataExplorer(true);

		await expect(async () => {
			const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			expect(tableData[0]).toStrictEqual({ 'Training': 'Strength', 'Pulse': '100.00', 'Duration': '60.00', 'Note': 'NA' });
			expect(tableData[1]).toStrictEqual({ 'Training': 'Stamina', 'Pulse': 'NA', 'Duration': '30.00', 'Note': 'NA' });
			expect(tableData[2]).toStrictEqual({ 'Training': 'Other', 'Pulse': '120.00', 'Duration': '45.00', 'Note': 'Note' });
			expect(tableData.length).toBe(3);
		}).toPass({ timeout: 60000 });



	});
	test('R - Verifies basic data explorer column info functionality [C734265]', {
		tag: [tags.CRITICAL]
	}, async function ({ app, r }) {
		await app.workbench.positronDataExplorer.expandSummary();

		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(1)).toBe('0%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(2)).toBe('33%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(3)).toBe('0%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(4)).toBe('66%');

		await app.workbench.positronLayouts.enterLayout('notebook');

		const col1ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(1);
		expect(col1ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Empty': '0', 'Unique': '3' });

		const col2ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(2);
		expect(col2ProfileInfo.profileData).toStrictEqual({ 'Missing': '1', 'Min': '100.00', 'Median': '110.00', 'Mean': '110.00', 'Max': '120.00', 'SD': '14.14' });

		const col3ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(3);
		expect(col3ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Min': '30.00', 'Median': '45.00', 'Mean': '45.00', 'Max': '60.00', 'SD': '15.00' });

		const col4ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(4);
		expect(col4ProfileInfo.profileData).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '2' });

		await app.workbench.positronLayouts.enterLayout('stacked');
		await app.workbench.positronSideBar.closeSecondarySideBar();

		await app.workbench.positronDataExplorer.closeDataExplorer();
		await app.workbench.positronQuickaccess.runCommand('workbench.panel.positronVariables.focus');

	});

	test('R - Open Data Explorer for the second time brings focus back [C701143]', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5714' }]
	}, async function ({ app, r }) {
		// Regression test for https://github.com/posit-dev/positron/issues/4197
		// and https://github.com/posit-dev/positron/issues/5714
		const script = `Data_Frame <- mtcars`;
		await app.workbench.positronConsole.executeCode('R', script, '>');
		await app.workbench.positronQuickaccess.runCommand('workbench.panel.positronVariables.focus');

		await expect(async () => {
			await app.workbench.positronVariables.doubleClickVariableRow('Data_Frame');
			await app.code.driver.page.locator('.label-name:has-text("Data: Data_Frame")').innerText();
		}).toPass();

		// Now move focus out of the the data explorer pane
		await app.workbench.editors.newUntitledFile();
		await app.workbench.positronQuickaccess.runCommand('workbench.panel.positronVariables.focus');
		await app.workbench.positronVariables.doubleClickVariableRow('Data_Frame');

		await expect(async () => {
			await app.code.driver.page.locator('.label-name:has-text("Data: Data_Frame")').innerText();
		}).toPass();

		await app.workbench.positronDataExplorer.closeDataExplorer();
		await app.workbench.positronQuickaccess.runCommand('workbench.panel.positronVariables.focus');
	});

	test('R - Check blank spaces in data explorer [C1078834]', async function ({ app, r }) {
		const script = `df = data.frame(x = c("a ", "a", "   ", ""))`;
		await app.workbench.positronConsole.executeCode('R', script, '>');

		await expect(async () => {
			await app.workbench.positronVariables.doubleClickVariableRow('df');
			await app.code.driver.page.locator('.label-name:has-text("Data: df")').innerText();
		}).toPass();

		await expect(async () => {
			const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			expect(tableData[0]).toStrictEqual({ 'x': 'a·' });
			expect(tableData[1]).toStrictEqual({ 'x': 'a' });
			expect(tableData[2]).toStrictEqual({ 'x': '···' });
			expect(tableData[3]).toStrictEqual({ 'x': '<empty>' });
			expect(tableData.length).toBe(4);
		}).toPass({ timeout: 60000 });
	});
});
