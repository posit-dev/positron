/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';

/*
 * Data explorer test suite for XLSX data frames
 */
export function setup(logger: Logger) {

	describe('Data Explorer - XLSX', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Data Explorer (XLSX file)', () => {

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

			it('Python - Verifies data explorer functionality with XLSX input', async function () {

				//TestRail 632940

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'read-xlsx-py', 'supermarket-sales.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				console.log('Opening data grid');
				await app.workbench.positronVariables.doubleClickVariableRow('df');

				await app.workbench.positronSideBar.closeSecondarySideBar();

				await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

				const visibleTableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				const firstRow = visibleTableData.at(0);
				expect(firstRow!['Invoice ID']).toBe('898-04-2717');

			});
		});

		describe('R Data Explorer (XLSX file)', () => {

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

			it('R - Verifies data explorer functionality with XLSX input', async function () {

				//TestRail 632941

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'read-xlsx-r', 'supermarket-sales.r'));
				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				console.log('Opening data grid');
				await app.workbench.positronVariables.doubleClickVariableRow('df2');

				await app.workbench.positronSideBar.closeSecondarySideBar();

				await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

				const visibleTableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

				const firstRow = visibleTableData.at(0);
				expect(firstRow!['Invoice ID']).toBe('898-04-2717');

			});
		});

	});
}
