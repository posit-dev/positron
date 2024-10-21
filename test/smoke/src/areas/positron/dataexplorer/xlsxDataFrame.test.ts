/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { join } from 'path';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

let logger;

describe('Data Explorer - XLSX #web #win', () => {
	logger = setupAndStartApp();

	describe('Python Data Explorer (XLSX file)', () => {

		before(async function () {

			await PositronPythonFixtures.SetupFixtures(this.app as Application);

		});

		after(async function () {

			const app = this.app as Application;

			await app.workbench.positronDataExplorer.closeDataExplorer();
			await app.workbench.positronVariables.openVariables();

		});

		it('Python - Verifies data explorer functionality with XLSX input [C632940]', async function () {

			const app = this.app as Application;
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'read-xlsx-py', 'supermarket-sales.py'));
			await app.workbench.quickaccess.runCommand('python.execInConsole');

			logger.log('Opening data grid');
			await expect(async () => {
				await app.workbench.positronVariables.doubleClickVariableRow('df');
				await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
			}).toPass();

			await app.workbench.positronSideBar.closeSecondarySideBar();

			await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

			const visibleTableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			const firstRow = visibleTableData.at(0);
			expect(firstRow!['Invoice ID']).toBe('898-04-2717');

		});
	});

	describe('R Data Explorer (XLSX file)', () => {

		before(async function () {

			await PositronRFixtures.SetupFixtures(this.app as Application);

		});

		after(async function () {

			const app = this.app as Application;

			await app.workbench.positronDataExplorer.closeDataExplorer();
			await app.workbench.positronVariables.openVariables();

		});

		it('R - Verifies data explorer functionality with XLSX input [C632941]', async function () {

			const app = this.app as Application;
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'read-xlsx-r', 'supermarket-sales.r'));
			await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

			logger.log('Opening data grid');
			await expect(async () => {
				await app.workbench.positronVariables.doubleClickVariableRow('df2');
				await app.code.driver.getLocator('.label-name:has-text("Data: df2")').innerText();
			}).toPass();

			await app.workbench.positronSideBar.closeSecondarySideBar();

			await app.workbench.positronDataExplorer.selectColumnMenuItem(1, 'Sort Descending');

			const visibleTableData = await app.workbench.positronDataExplorer.getDataExplorerTableData();

			const firstRow = visibleTableData.at(0);
			expect(firstRow!['Invoice ID']).toBe('898-04-2717');

		});
	});

});
