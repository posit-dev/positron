/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Python Pandas', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.DATA_EXPLORER]
}, () => {
	test('Python Pandas - Can send code to console, open data grid, and verify data', async function ({ app, python, logger }) {
		// modified snippet from https://www.geeksforgeeks.org/python-pandas-dataframe/
		const script = `import pandas as pd
data = {'Name':['Jai', 'Princi', 'Gaurav', 'Anuj'],
		'Age':[27, 24, 22, 32],
		'Address':['Delhi', 'Kanpur', 'Allahabad', 'Kannauj']}
df = pd.DataFrame(data)`;

		logger.log('Sending code to console');
		await app.workbench.console.executeCode('Python', script);

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df');
			await app.code.driver.page.locator('.label-name:has-text("Data: df")').innerText();
		}).toPass();

		await app.workbench.sideBar.closeSecondarySideBar();

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

			expect(tableData[0]).toStrictEqual({ 'Name': 'Jai', 'Age': '27', 'Address': 'Delhi' });
			expect(tableData[1]).toStrictEqual({ 'Name': 'Princi', 'Age': '24', 'Address': 'Kanpur' });
			expect(tableData[2]).toStrictEqual({ 'Name': 'Gaurav', 'Age': '22', 'Address': 'Allahabad' });
			expect(tableData[3]).toStrictEqual({ 'Name': 'Anuj', 'Age': '32', 'Address': 'Kannauj' });
			expect(tableData.length).toBe(4);
		}).toPass({ timeout: 60000 });

		await app.workbench.dataExplorer.closeDataExplorer();
		await app.workbench.variables.toggleVariablesView();
	});

	test('Python Pandas - Verifies data explorer functionality with empty fields', async function ({ app, python, logger }) {
		const script = `import numpy as np
import pandas as pd

data = {
		'A': [1, 2, np.nan, 4, 5],
		'B': ['foo', np.nan, 'bar', 'baz', None],
		'C': [np.nan, 2.5, 3.1, None, 4.8],
		'D': [np.nan, pd.NaT, pd.Timestamp('2023-01-01'), pd.NaT, pd.Timestamp('2023-02-01')],
		'E': [None, 'text', 'more text', np.nan, 'even more text']
}
df2 = pd.DataFrame(data)`;

		logger.log('Sending code to console');
		await app.workbench.console.executeCode('Python', script);

		logger.log('Opening data grid');
		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df2');
			await app.code.driver.page.locator('.label-name:has-text("Data: df2")').innerText();
		}).toPass();

		// Need to make sure the data explorer is visible test.beforeAll we can interact with it
		await app.workbench.dataExplorer.maximizeDataExplorer(true);

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

			expect(tableData[0]).toStrictEqual({ 'A': '1.00', 'B': 'foo', 'C': 'NaN', 'D': 'NaT', 'E': 'None' });
			expect(tableData[1]).toStrictEqual({ 'A': '2.00', 'B': 'NaN', 'C': '2.50', 'D': 'NaT', 'E': 'text' });
			expect(tableData[2]).toStrictEqual({ 'A': 'NaN', 'B': 'bar', 'C': '3.10', 'D': '2023-01-01 00:00:00', 'E': 'more text' });
			expect(tableData[3]).toStrictEqual({ 'A': '4.00', 'B': 'baz', 'C': 'NaN', 'D': 'NaT', 'E': 'NaN' });
			expect(tableData[4]).toStrictEqual({ 'A': '5.00', 'B': 'None', 'C': '4.80', 'D': '2023-02-01 00:00:00', 'E': 'even more text' });
			expect(tableData.length).toBe(5);
		}).toPass({ timeout: 60000 });

		// Need to expand summary for next test
		await app.workbench.dataExplorer.expandSummary();

	});

	// Cannot be run by itself, relies on the previous test
	test('Python Pandas - Verifies data explorer column info functionality', async function ({ app, python }) {
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(1)).toBe('20%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(2)).toBe('40%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(3)).toBe('40%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(4)).toBe('60%');
		expect(await app.workbench.dataExplorer.getColumnMissingPercent(5)).toBe('40%');

		await app.workbench.layouts.enterLayout('notebook');

		const col1ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(1);
		expect(col1ProfileInfo.profileData).toStrictEqual({ 'Missing': '1', 'Min': '1.00', 'Median': '3.00', 'Mean': '3.00', 'Max': '5.00', 'SD': '1.83' });

		const col2ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(2);
		expect(col2ProfileInfo.profileData).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '3' });

		const col3ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(3);
		expect(col3ProfileInfo.profileData).toStrictEqual({ 'Missing': '2', 'Min': '2.50', 'Median': '3.10', 'Mean': '3.47', 'Max': '4.80', 'SD': '1.19' });

		const col4ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(4);
		expect(col4ProfileInfo.profileData).toStrictEqual({ 'Missing': '3', 'Min': '2023-01-01 00:00:00', 'Median': 'NaT', 'Max': '2023-02-01 00:00:00', 'Timezone': 'None' });

		const col5ProfileInfo = await app.workbench.dataExplorer.getColumnProfileInfo(5);
		expect(col5ProfileInfo.profileData).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '3' });

		await app.workbench.layouts.enterLayout('stacked');
		await app.workbench.sideBar.closeSecondarySideBar();

		await app.workbench.dataExplorer.closeDataExplorer();
		await app.workbench.variables.toggleVariablesView();

	});

	// This test is not dependent on the previous test, so it refreshes the python environment
	test('FIXME!!!! - Python Pandas - Verifies data explorer test.afterAll modification', async function ({ app, python }) {
		// Restart python for clean environment & open the file
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.console.barClearButton.click();
		await app.workbench.console.barRestartButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await expect(app.workbench.console.activeConsole.getByText('restarted')).toBeVisible({ timeout: 60000 });

		const filename = 'pandas-update-dataframe.ipynb';
		await app.workbench.notebooks.openNotebook(join(app.workspacePathOrFolder, 'workspaces', 'data-explorer-update-datasets', filename));
		await app.workbench.notebooks.selectInterpreter('Python', process.env.POSITRON_PY_VER_SEL!);
		await app.workbench.notebooks.focusFirstCell();
		await app.workbench.notebooks.executeActiveCell();

		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df');
			await app.code.driver.page.locator('.label-name:has-text("Data: df")').innerText();
		}).toPass({ timeout: 50000 });

		await app.workbench.layouts.enterLayout('notebook');

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
			expect(tableData.length).toBe(11);
		}).toPass({ timeout: 60000 });

		await app.code.driver.page.locator('.tabs .label-name:has-text("pandas-update-dataframe.ipynb")').click();
		await app.workbench.notebooks.focusNextCell();
		await app.workbench.notebooks.executeActiveCell();
		await app.code.driver.page.locator('.label-name:has-text("Data: df")').click();

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
			expect(tableData.length).toBe(12);
		}).toPass({ timeout: 60000 });

		await app.code.driver.page.locator('.tabs .label-name:has-text("pandas-update-dataframe.ipynb")').click();
		await app.workbench.notebooks.focusNextCell();
		await app.workbench.notebooks.executeActiveCell();
		await app.code.driver.page.locator('.label-name:has-text("Data: df")').click();
		await app.workbench.dataExplorer.selectColumnMenuItem(1, 'Sort Descending');

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
			expect(tableData[0]).toStrictEqual({ 'Year': '2025' });
			expect(tableData.length).toBe(12);
		}).toPass({ timeout: 60000 });

		await app.workbench.layouts.enterLayout('stacked');
		await app.workbench.dataExplorer.closeDataExplorer();
	});

	test('Python - Open Data Explorer for the second time brings focus back', async function ({ app, python }) {

		const script = `import pandas as pd
Data_Frame = pd.DataFrame({
	"mpg": [21.0, 21.0, 22.8, 21.4, 18.7],
	"cyl": [6, 6, 4, 6, 8],
	"disp": [160.0, 160.0, 108.0, 258.0, 360.0],
	"hp": [110, 110, 93, 110, 175],
	"drat": [3.90, 3.90, 3.85, 3.08, 3.15],
	"wt": [2.62, 2.875, 2.32, 3.215, 3.44],
	"qsec": [16.46, 17.02, 18.61, 19.44, 17.02],
	"vs": [0, 0, 1, 1, 0],
	"am": [1, 1, 1, 0, 0],
	"gear": [4, 4, 4, 3, 3],
	"carb": [4, 4, 1, 1, 2]
})`;
		await app.workbench.console.executeCode('Python', script);
		await app.workbench.variables.focusVariablesView();

		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('Data_Frame');
			await app.code.driver.page.locator('.label-name:has-text("Data: Data_Frame")').innerText();
		}).toPass();

		// Now move focus out of the the data explorer pane
		await app.workbench.editors.newUntitledFile();
		await app.workbench.variables.focusVariablesView();
		await app.workbench.variables.doubleClickVariableRow('Data_Frame');

		await expect(async () => {
			await app.code.driver.page.locator('.label-name:has-text("Data: Data_Frame")').innerText();
		}).toPass();

		await app.workbench.dataExplorer.closeDataExplorer();
		await app.workbench.variables.focusVariablesView();
	});

	test('Python - Verify blank spaces in data explorer', async function ({ app, python }) {

		const script = `import pandas as pd
df = pd.DataFrame({'x': ["a ", "a", "   ", ""]})`;
		await app.workbench.console.executeCode('Python', script);

		await expect(async () => {
			await app.workbench.variables.doubleClickVariableRow('df');
			await app.code.driver.page.locator('.label-name:has-text("Data: df")').innerText();
		}).toPass();

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

			expect(tableData[0]).toStrictEqual({ 'x': 'a·' });
			expect(tableData[1]).toStrictEqual({ 'x': 'a' });
			expect(tableData[2]).toStrictEqual({ 'x': '···' });
			expect(tableData[3]).toStrictEqual({ 'x': '<empty>' });
			expect(tableData.length).toBe(4);
		}).toPass({ timeout: 60000 });

		await app.workbench.dataExplorer.closeDataExplorer();
	});
});
