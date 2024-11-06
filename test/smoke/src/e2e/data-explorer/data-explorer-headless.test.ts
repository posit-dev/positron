/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';
import { Application, Logger } from '../../../../automation';

test.use({
	suiteId: __filename
});

test.describe('Headless Data Explorer - Large Data Frame', {
	tag: ['@web']
}, () => {
	test.beforeEach(async function ({ app, python }) {
		await app.workbench.positronLayouts.enterLayout('stacked');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronDataExplorer.closeDataExplorer();
	});

	test('Verifies headless data explorer functionality with large parquet file [C938893]', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.parquet');
	});

	test('Verifies headless data explorer functionality with large csv file [C938894]', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.csv');
	});
});

async function testBody(app: Application, logger: Logger, fileName: string) {
	const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';

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
