/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';
import { Application, Logger } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('Headless Data Explorer - Large Data Frame', {
	tag: [tags.WEB, tags.DATA_EXPLORER, tags.DUCK_DB, tags.WIN]
}, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('stacked');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.dataExplorer.closeDataExplorer();
	});

	test('Verifies headless data explorer functionality with large parquet file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.parquet');
	});

	test('Verifies headless data explorer functionality with large csv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.csv');
	});

	test('Verifies headless data explorer functionality with large gzipped csv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.csv.gz');
	});

	test('Verifies headless data explorer functionality with large tsv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.tsv');
	});

	test('Verifies headless data explorer functionality with large gzipped tsv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.tsv.gz');
	});
});

async function testBody(app: Application, logger: Logger, fileName: string) {
	const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';

	await app.workbench.quickaccess.openDataFile(join(app.workspacePathOrFolder, 'data-files', 'flights', fileName));

	logger.log('Opening data grid');
	await expect(async () => {
		expect(await app.code.driver.page.locator(`.label-name:has-text("Data: ${fileName}")`).innerText() === `Data: ${fileName}`);
	}).toPass();

	await app.workbench.sideBar.closeSecondarySideBar();

	await expect(async () => {
		// Validate full grid by checking bottom right corner data
		await app.workbench.dataExplorer.clickLowerRightCorner();
		const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
		const lastRow = tableData.at(-1);
		const lastHour = lastRow!['time_hour'];
		expect(lastHour).toBe(LAST_CELL_CONTENTS);

		// If file is plaintext (csv, tsv), check for the plaintext button in the actiobar
		// Otherwise, ensure the button is not present
		const shouldHavePlaintext = fileName.endsWith('.csv') || fileName.endsWith('.tsv');
		const plaintextEl = app.code.driver.page.getByLabel('Open as Plain Text File');
		expect(await plaintextEl.isVisible()).toBe(shouldHavePlaintext);
	}).toPass();
}
