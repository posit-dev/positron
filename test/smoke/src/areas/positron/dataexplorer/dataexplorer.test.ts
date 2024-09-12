/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';

/*
 *  Data explorer tests with small data frames
 */
export function setup(logger: Logger) {
	// There is a known issue with the data explorer tests causing them to intermittently fail:
	// https://github.com/posit-dev/positron/issues/4663
	describe.skip('Data Explorer', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Pandas Data Explorer', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));

			});

			it('Python Pandas - Verifies basic data explorer functionality [C557556] #pr', async function () {
				const app = this.app as Application;

				// modified snippet from https://www.geeksforgeeks.org/python-pandas-dataframe/
				const script = `import pandas as pd
data = {'Name':['Jai', 'Princi', 'Gaurav', 'Anuj'],
		'Age':[27, 24, 22, 32],
		'Address':['Delhi', 'Kanpur', 'Allahabad', 'Kannauj']}
df = pd.DataFrame(data)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df');
					await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				await expect(async () => {

					const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

					expect(tableData[0]).toStrictEqual({ 'Name': 'Jai', 'Age': '27', 'Address': 'Delhi' });
					expect(tableData[1]).toStrictEqual({ 'Name': 'Princi', 'Age': '24', 'Address': 'Kanpur' });
					expect(tableData[2]).toStrictEqual({ 'Name': 'Gaurav', 'Age': '22', 'Address': 'Allahabad' });
					expect(tableData[3]).toStrictEqual({ 'Name': 'Anuj', 'Age': '32', 'Address': 'Kannauj' });
					expect(tableData.length).toBe(4);
				}).toPass({ timeout: 60000 });

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();

			});

			it('Python Pandas - Verifies data explorer functionality with empty fields [C718262] #pr', async function () {
				const app = this.app as Application;

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
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df2');
					await app.code.driver.getLocator('.label-name:has-text("Data: df2")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				await expect(async () => {
					const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

					expect(tableData[0]).toStrictEqual({ 'A': '1.00', 'B': 'foo', 'C': 'NaN', 'D': 'NaT', 'E': 'None' });
					expect(tableData[1]).toStrictEqual({ 'A': '2.00', 'B': 'NaN', 'C': '2.50', 'D': 'NaT', 'E': 'text' });
					expect(tableData[2]).toStrictEqual({ 'A': 'NaN', 'B': 'bar', 'C': '3.10', 'D': '2023-01-01 00:00:00', 'E': 'more text' });
					expect(tableData[3]).toStrictEqual({ 'A': '4.00', 'B': 'baz', 'C': 'NaN', 'D': 'NaT', 'E': 'NaN' });
					expect(tableData[4]).toStrictEqual({ 'A': '5.00', 'B': 'None', 'C': '4.80', 'D': '2023-02-01 00:00:00', 'E': 'even more text' });
					expect(tableData.length).toBe(5);
				}).toPass({ timeout: 60000 });


			});
			it('Python Pandas - Verifies data explorer column info functionality [C734263] #pr', async function () {

				const app = this.app as Application;

				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(1)).toBe('20%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(2)).toBe('40%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(3)).toBe('40%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(4)).toBe('60%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(5)).toBe('40%');

				await app.workbench.positronLayouts.enterLayout('notebook');

				const col1ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(1);
				expect(col1ProfileInfo).toStrictEqual({ 'Missing': '1', 'Min': '1.00', 'Median': '3.00', 'Mean': '3.00', 'Max': '5.00', 'SD': '1.83' });

				const col2ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(2);
				expect(col2ProfileInfo).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '3' });

				const col3ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(3);
				expect(col3ProfileInfo).toStrictEqual({ 'Missing': '2', 'Min': '2.50', 'Median': '3.10', 'Mean': '3.47', 'Max': '4.80', 'SD': '1.19' });

				const col4ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(4);
				expect(col4ProfileInfo).toStrictEqual({ 'Missing': '3', 'Min': '2023-01-01 00:00:00', 'Median': 'NaT', 'Max': '2023-02-01 00:00:00', 'Timezone': 'None' });

				const col5ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(5);
				expect(col5ProfileInfo).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '3' });

				await app.workbench.positronLayouts.enterLayout('stacked');
				await app.workbench.positronSideBar.closeSecondarySideBar();

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();

			});
			// This test is not dependent on the previous test, so it refreshes the python environment
			it('Python Pandas - Verifies data explorer after modification [C557574] #pr', async function () {

				const app = this.app as Application;
				// Restart python for clean environment & open the file
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.barClearButton.click();
				await app.workbench.positronConsole.barRestartButton.click();
				await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));

				await app.workbench.positronNotebooks.openNotebook(join(app.workspacePathOrFolder, 'workspaces', 'data-explorer-update-datasets', 'pandas-update-dataframe.ipynb'));
				await app.workbench.notebook.focusFirstCell();
				await app.workbench.notebook.executeActiveCell();
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df');
					await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
				}).toPass({ timeout: 50000 });

				await app.workbench.positronLayouts.enterLayout('notebook');

				await expect(async () => {
					const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();
					expect(tableData.length).toBe(11);
				}).toPass({ timeout: 60000 });

				await app.code.driver.getLocator('.tabs .label-name:has-text("pandas-update-dataframe.ipynb")').click();
				await app.workbench.notebook.focusNextCell();
				await app.workbench.notebook.executeActiveCell();
				await app.code.driver.getLocator('.label-name:has-text("Data: df")').click();

				await expect(async () => {
					const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();
					expect(tableData.length).toBe(12);
				}).toPass({ timeout: 60000 });

				await app.code.driver.getLocator('.tabs .label-name:has-text("pandas-update-dataframe.ipynb")').click();
				await app.workbench.notebook.focusNextCell();
				await app.workbench.notebook.executeActiveCell();
				await app.code.driver.getLocator('.label-name:has-text("Data: df")').click();
				await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

				await expect(async () => {
					const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();
					expect(tableData[0]).toStrictEqual({ 'Year': '2025' });
					expect(tableData.length).toBe(12);
				}).toPass({ timeout: 60000 });

				await app.workbench.positronLayouts.enterLayout('stacked');
			});
		});

		describe('Python Polars Data Explorer', () => {
			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });

			});

			it('Python Polars - Verifies basic data explorer functionality [C644538] #pr', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'polars-dataframe-py', 'polars_basic.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df');
					await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

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
			it('Python Polars - Verifies basic data explorer column info functionality [C734264] #pr', async function () {

				const app = this.app as Application;

				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(1)).toBe('0%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(2)).toBe('0%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(3)).toBe('0%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(4)).toBe('33%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(5)).toBe('33%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(6)).toBe('33%');

				await app.workbench.positronLayouts.enterLayout('notebook');

				const col1ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(1);
				expect(col1ProfileInfo).toStrictEqual({ 'Missing': '0', 'Min': '1.00', 'Median': '2.00', 'Mean': '2.00', 'Max': '3.00', 'SD': '1.00' });

				const col2ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(2);
				expect(col2ProfileInfo).toStrictEqual({ 'Missing': '0', 'Min': '6.00', 'Median': '7.00', 'Mean': '7.00', 'Max': '8.00', 'SD': '1.00' });

				const col3ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(3);
				expect(col3ProfileInfo).toStrictEqual({ 'Missing': '0', 'Min': '2020-01-02', 'Median': '2021-03-04', 'Max': '2022-05-06' });

				const col4ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(4);
				expect(col4ProfileInfo).toStrictEqual({ 'Missing': '1', 'Min': '2.00', 'Median': '2.50', 'Mean': '2.50', 'Max': '3.00', 'SD': '0.7071' });

				const col5ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(5);
				expect(col5ProfileInfo).toStrictEqual({ 'Missing': '1', 'Min': '0.5000', 'Median': '1.50', 'Mean': '1.50', 'Max': '2.50', 'SD': '1.41' });

				const col6ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(6);
				expect(col6ProfileInfo).toStrictEqual({ 'Missing': '1', 'True': '1', 'False': '1' });

				await app.workbench.positronLayouts.enterLayout('stacked');
				await app.workbench.positronSideBar.closeSecondarySideBar();

			});

			it('Python Polars - Add Simple Column filter [C557557] #pr', async function () {
				const app = this.app as Application;
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

			it('Python Polars - Add Simple Column Sort [C557561] #pr', async function () {
				const app = this.app as Application;
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

		describe('R Data Explorer', () => {

			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('R - Verifies basic data explorer functionality [C609620] #pr', async function () {
				const app = this.app as Application;

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
					await app.code.driver.getLocator('.label-name:has-text("Data: Data_Frame")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				await expect(async () => {
					const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

					expect(tableData[0]).toStrictEqual({ 'Training': 'Strength', 'Pulse': '100.00', 'Duration': '60.00', 'Note': 'NA' });
					expect(tableData[1]).toStrictEqual({ 'Training': 'Stamina', 'Pulse': 'NA', 'Duration': '30.00', 'Note': 'NA' });
					expect(tableData[2]).toStrictEqual({ 'Training': 'Other', 'Pulse': '120.00', 'Duration': '45.00', 'Note': 'Note' });
					expect(tableData.length).toBe(3);
				}).toPass({ timeout: 60000 });


			});
			it('R - Verifies basic data explorer column info functionality [C734265] #pr', async function () {

				const app = this.app as Application;

				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(1)).toBe('0%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(2)).toBe('33%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(3)).toBe('0%');
				expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(4)).toBe('66%');

				await app.workbench.positronLayouts.enterLayout('notebook');

				const col1ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(1);
				expect(col1ProfileInfo).toStrictEqual({ 'Missing': '0', 'Empty': '0', 'Unique': '3' });

				const col2ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(2);
				expect(col2ProfileInfo).toStrictEqual({ 'Missing': '1', 'Min': '100.00', 'Median': '110.00', 'Mean': '110.00', 'Max': '120.00', 'SD': '14.14' });

				const col3ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(3);
				expect(col3ProfileInfo).toStrictEqual({ 'Missing': '0', 'Min': '30.00', 'Median': '45.00', 'Mean': '45.00', 'Max': '60.00', 'SD': '15.00' });

				const col4ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(4);
				expect(col4ProfileInfo).toStrictEqual({ 'Missing': '2', 'Empty': '0', 'Unique': '2' });

				await app.workbench.positronLayouts.enterLayout('stacked');
				await app.workbench.positronSideBar.closeSecondarySideBar();

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.quickaccess.runCommand('workbench.panel.positronVariables.focus');

			});

			it('R - Open Data Explorer for the second time brings focus back [C701143]', async function () {
				// Regression test for https://github.com/posit-dev/positron/issues/4197
				const app = this.app as Application;

				const script = `Data_Frame <- mtcars`;
				await app.workbench.positronConsole.executeCode('R', script, '>');
				await app.workbench.quickaccess.runCommand('workbench.panel.positronVariables.focus');

				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('Data_Frame');
					await app.code.driver.getLocator('.label-name:has-text("Data: Data_Frame")').innerText();
				}).toPass();

				// Now move focus out of the the data explorer pane
				await app.workbench.editors.newUntitledFile();
				await app.workbench.quickaccess.runCommand('workbench.panel.positronVariables.focus');
				await app.workbench.positronVariables.doubleClickVariableRow('Data_Frame');

				await expect(async () => {
					await app.code.driver.getLocator('.label-name:has-text("Data: Data_Frame")').innerText();
				}).toPass();

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.quickaccess.runCommand('workbench.panel.positronVariables.focus');

			});
		});
	});
}
