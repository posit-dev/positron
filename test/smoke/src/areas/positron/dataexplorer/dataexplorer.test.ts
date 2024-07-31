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
	describe('Data Explorer', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Pandas Data Explorer', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
				await app.workbench.positronConsole.barRestartButton.click();
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

				const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				expect(tableData[0]).toStrictEqual({ 'Name': 'Jai', 'Age': '27', 'Address': 'Delhi' });
				expect(tableData[1]).toStrictEqual({ 'Name': 'Princi', 'Age': '24', 'Address': 'Kanpur' });
				expect(tableData[2]).toStrictEqual({ 'Name': 'Gaurav', 'Age': '22', 'Address': 'Allahabad' });
				expect(tableData[3]).toStrictEqual({ 'Name': 'Anuj', 'Age': '32', 'Address': 'Kannauj' });
				expect(tableData.length).toBe(4);

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

			});

			it('Python Polars - Add Simple Column filter [C557557] #pr', async function () {
				const app = this.app as Application;
				const FILTER_PARAMS = ['foo', 'is not equal to', '1'];
				await app.workbench.positronDataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);

				const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				expect(tableData[0]['foo']).toBe('2');
				expect(tableData[1]['foo']).toBe('3');
				expect(tableData[0]['bar']).toBe('7.00');
				expect(tableData[1]['bar']).toBe('8.00');
				expect(tableData[0]['ham']).toBe('2021-03-04');
				expect(tableData[1]['ham']).toBe('2022-05-06');
				expect(tableData.length).toBe(2);
			});

			it('Python Polars - Add Simple Column Sort [C557561] #pr', async function () {
				const app = this.app as Application;
				await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

				let tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				expect(tableData[0]['foo']).toBe('3');
				expect(tableData[1]['foo']).toBe('2');
				expect(tableData[0]['bar']).toBe('8.00');
				expect(tableData[1]['bar']).toBe('7.00');
				expect(tableData[0]['ham']).toBe('2022-05-06');
				expect(tableData[1]['ham']).toBe('2021-03-04');
				expect(tableData.length).toBe(2);

				await app.workbench.positronDataExplorer.clearSortingButton.click();

				tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				expect(tableData[0]['foo']).toBe('2');
				expect(tableData[1]['foo']).toBe('3');
				expect(tableData[0]['bar']).toBe('7.00');
				expect(tableData[1]['bar']).toBe('8.00');
				expect(tableData[0]['ham']).toBe('2021-03-04');
				expect(tableData[1]['ham']).toBe('2022-05-06');
				expect(tableData.length).toBe(2);

			});
		});

		describe('R Data Explorer', () => {

			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			afterEach(async function () {
				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.quickaccess.runCommand('workbench.panel.positronVariables.focus');

			});

			it('R - Verifies basic data explorer functionality [C609620] #pr', async function () {
				const app = this.app as Application;

				// snippet from https://www.w3schools.com/r/r_data_frames.asp
				const script = `Data_Frame <- data.frame (
	Training = c("Strength", "Stamina", "Other"),
	Pulse = c(100, 150, 120),
	Duration = c(60, 30, 45)
)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('Data_Frame');
					await app.code.driver.getLocator('.label-name:has-text("Data: Data_Frame")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				expect(tableData[0]).toStrictEqual({ 'Training': 'Strength', 'Pulse': '100.00', 'Duration': '60.00' });
				expect(tableData[1]).toStrictEqual({ 'Training': 'Stamina', 'Pulse': '150.00', 'Duration': '30.00' });
				expect(tableData[2]).toStrictEqual({ 'Training': 'Other', 'Pulse': '120.00', 'Duration': '45.00' });
				expect(tableData.length).toBe(3);

			});

			it('R - Open Data Explorer for the second time brings focus back', async function () {
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

			});
		});
	});
}
