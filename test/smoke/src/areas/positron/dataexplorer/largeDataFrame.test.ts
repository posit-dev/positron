/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';


/*
 * Data explorer test suite for large data frames
 */
export function setup(logger: Logger) {

	const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';
	const FILTER_PARAMS = ['distance', 'is equal to', '2586'];
	const POST_FILTER_DATA_SUMMARY = 'Showing 8,204 rows (2.44% of 336,776 total)  19 columns';

	describe('Data Explorer - Large Data Frame', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Data Explorer (Large Data Frame)', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();

			});

			it('Python - Verifies data explorer functionality with large data frame', async function () {
				//TestRail #557555
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df');
					await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
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

				// Filter data set
				await app.workbench.positronDataExplorer.clickUpperLeftCorner();
				await app.workbench.positronDataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);

				await expect(async () => {
					const statusBar = await app.workbench.positronDataExplorer.getDataExplorerStatusBar();
					expect(statusBar.textContent).toBe(POST_FILTER_DATA_SUMMARY);
				}).toPass();

			});
		});

		describe('R Data Explorer (Large Data Frame)', () => {

			before(async function () {

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();

			});

			it('R - Verifies data explorer functionality with large data frame', async function () {
				// TestRail #557554
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df2');
					await app.code.driver.getLocator('.label-name:has-text("Data: df2")').innerText();
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

				// Filter data set
				await app.workbench.positronDataExplorer.clickUpperLeftCorner();
				await app.workbench.positronDataExplorer.addFilter(...FILTER_PARAMS as [string, string, string]);

				await expect(async () => {
					const statusBar = await app.workbench.positronDataExplorer.getDataExplorerStatusBar();
					expect(statusBar.textContent).toBe(POST_FILTER_DATA_SUMMARY);
				}).toPass();

			});
		});


	});
}
