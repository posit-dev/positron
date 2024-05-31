/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';


export function setup(logger: Logger) {
	describe('Data Explorer', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Data Explorer', () => {

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

			it('Python - Verifies basic data explorer functionality', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'positron-workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				console.log('Opening data grid');
				await app.workbench.positronVariables.doubleClickVariableRow('df');

				await app.workbench.positronSideBar.closeSecondarySideBar();

				await app.code.waitAndClick('.data-grid-scrollbar-corner');

				const tableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				const lastRow = tableData.at(-1);

				expect(lastRow!['time_hour']).toBe('2013-09-30 08:00:00');

				await app.code.waitAndClick('.data-grid-corner-top-left');

				await app.code.waitAndClick('.codicon-positron-add-filter');

				await app.code.waitAndClick('.positron-modal-overlay .drop-down-column-selector');

				await app.code.waitForSetValue('.positron-modal-overlay .column-search-input .text-input', 'distance\n');

				await app.code.waitAndClick('.column-selector-cell');

				await app.code.waitAndClick('.positron-modal-overlay .drop-down-list-box');

				// does not work
				// await app.code.waitAndClick('.positron-modal-overlay .positron-button div[text*="is equal to"]');

				const equalTo = app.code.driver.getLocator('.positron-modal-overlay .positron-button div:has-text("is equal to")');
				await equalTo.click();

				console.log('a');

			});
		});
	});
}
