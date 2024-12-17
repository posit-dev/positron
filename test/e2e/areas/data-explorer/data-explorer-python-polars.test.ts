/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Python Polars', {
	tag: [tags.WIN, tags.WEB, tags.CRITICAL, tags.DATA_EXPLORER]
}, () => {
	test('Python Polars - Verifies basic data explorer functionality [C644538]', async function ({ app, python, logger }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'polars-dataframe-py', 'polars_basic.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.positronVariables.doubleClickVariableRow('df');
			await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
		}).toPass();

		await app.workbench.positronDataExplorer.maximizeDataExplorer(true);

		await expect(async () => {
			const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			expect(tableData[0]['foo']).toBe('1');
			expect(tableData[1]['foo']).toBe('2');
			expect(tableData[2]['foo']).toBe('3');
			expect(tableData[0]['bar']).toBe('6.00');
			expect(tableData[1]['bar']).toBe('7.00');
			expect(tableData[2]['bar']).toBe('8.00');
			expect(tableData[0]['ham']).toBe('2020-01-02');
			expect(tableData[1]['ham']).toBe('2021-03-04');
			expect(tableData[2]['ham']).toBe('2022-05-06');
			expect(tableData.length).toBe(3);
		}).toPass({ timeout: 60000 });

	});

	// Cannot be run by itself, relies on the previous test
	test('Python Polars - Verifies basic data explorer column info functionality [C734264]', async function ({ app, python }) {
		await app.workbench.positronDataExplorer.expandSummary();

		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(1)).toBe('0%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(2)).toBe('0%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(3)).toBe('0%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(4)).toBe('33%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(5)).toBe('33%');
		expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(6)).toBe('33%');


		const col1ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(1);
		expect(col1ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Min': '1.00', 'Median': '2.00', 'Mean': '2.00', 'Max': '3.00', 'SD': '1.00' });

		const col2ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(2);
		expect(col2ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Min': '6.00', 'Median': '7.00', 'Mean': '7.00', 'Max': '8.00', 'SD': '1.00' });

		const col3ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(3);
		expect(col3ProfileInfo.profileData).toStrictEqual({ 'Missing': '0', 'Min': '2020-01-02', 'Median': '2021-03-04', 'Max': '2022-05-06' });

		const col4ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(4);
		expect(col4ProfileInfo.profileData).toStrictEqual({ 'Missing': '1', 'Min': '2.00', 'Median': '2.50', 'Mean': '2.50', 'Max': '3.00', 'SD': '0.7071' });

		const col5ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(5);
		expect(col5ProfileInfo.profileData).toStrictEqual({ 'Missing': '1', 'Min': '0.5000', 'Median': '1.50', 'Mean': '1.50', 'Max': '2.50', 'SD': '1.41' });

		const col6ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(6);
		expect(col6ProfileInfo.profileData).toStrictEqual({ 'Missing': '1', 'True': '1', 'False': '1' });

		await app.workbench.positronDataExplorer.collapseSummary();

	});

	test('Python Polars - Add Simple Column filter [C557557]', async function ({ app, python }) {

		const FILTER_PARAMS = ['foo', 'is not equal to', '1'];
		await app.workbench.positronDataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);

		await expect(async () => {

			const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			expect(tableData[0]['foo']).toBe('2');
			expect(tableData[1]['foo']).toBe('3');
			expect(tableData[0]['bar']).toBe('7.00');
			expect(tableData[1]['bar']).toBe('8.00');
			expect(tableData[0]['ham']).toBe('2021-03-04');
			expect(tableData[1]['ham']).toBe('2022-05-06');
			expect(tableData.length).toBe(2);

		}).toPass({ timeout: 60000 });
	});

	test('Python Polars - Add Simple Column Sort [C557561]', async function ({ app, python }) {
		await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

		let tableData;
		await expect(async () => {
			tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			expect(tableData[0]['foo']).toBe('3');
			expect(tableData[1]['foo']).toBe('2');
			expect(tableData[0]['bar']).toBe('8.00');
			expect(tableData[1]['bar']).toBe('7.00');
			expect(tableData[0]['ham']).toBe('2022-05-06');
			expect(tableData[1]['ham']).toBe('2021-03-04');
			expect(tableData.length).toBe(2);
		}).toPass({ timeout: 60000 });

		await app.workbench.positronDataExplorer.clearSortingButton.click();

		await expect(async () => {
			tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			expect(tableData[0]['foo']).toBe('2');
			expect(tableData[1]['foo']).toBe('3');
			expect(tableData[0]['bar']).toBe('7.00');
			expect(tableData[1]['bar']).toBe('8.00');
			expect(tableData[0]['ham']).toBe('2021-03-04');
			expect(tableData[1]['ham']).toBe('2022-05-06');
			expect(tableData.length).toBe(2);
		}).toPass({ timeout: 60000 });

	});
});
