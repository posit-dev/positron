/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures } from '../../../../../automation';
import { join } from 'path';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

let logger;

const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';

describe('Headless Data Explorer - Large Data Frame #web', () => {
	logger = setupAndStartApp();

	async function testBody(app: Application, fileName: string) {

		await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'data-files', 'flights', fileName));

		logger.log('Opening data grid');
		await expect(async () => {
			expect(await app.code.driver.getLocator(`.label-name:has-text("Data: ${fileName}")`).innerText() === `Data: ${fileName}`);
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
	}


	describe('Headless Data Explorer (Large Data Frame)', () => {

		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);

			await this.app.workbench.positronLayouts.enterLayout('stacked');

		});

		afterEach(async function () {
			const app = this.app as Application;
			await app.workbench.positronDataExplorer.closeDataExplorer();

		});

		it('Verifies headless data explorer functionality with large parquet file [C938893]', async function () {
			await testBody(this.app as Application, 'flights.parquet');
		});


		it('Verifies headless data explorer functionality with large csv file [C938894]', async function () {
			await testBody(this.app as Application, 'flights.csv');
		});
	});

});
