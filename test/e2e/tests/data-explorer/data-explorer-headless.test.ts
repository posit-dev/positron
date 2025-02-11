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

	test('Verify headless data explorer functionality with large parquet file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.parquet');
	});

	test('Verify headless data explorer functionality with large csv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.csv');
	});

	test('Verify headless data explorer functionality with large gzipped csv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.csv.gz');
	});

	test('Verify headless data explorer functionality with large tsv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.tsv');
	});

	test('Verify headless data explorer functionality with large gzipped tsv file', async function ({ app, logger }) {
		await testBody(app, logger, 'flights.tsv.gz');
	});

	test('Verify headless data explorer can open csv file as plaintext', async function ({ app, logger }) {
		const fileName = 'flights.csv';
		const searchString = ',year,month,day,dep_time,sched_dep_time,dep_delay,arr_time,sched_arr_time,arr_delay,carrier,flight,tailnum,origin,dest,air_time,distance,hour,minute,time_hour';

		await openAsPlaintext(app, fileName, searchString);
	});

	test('Verify headless data explorer can open tsv file as plaintext', async function ({ app, logger }) {
		const fileName = 'flights.tsv';
		const searchString = /\s+year\s+month\s+day\s+dep_time\s+sched_dep_time\s+dep_delay\s+arr_time\s+sched_arr_time\s+arr_delay\s+carrier\s+flight\s+tailnum\s+origin\s+dest\s+air_time\s+distance\s+hour\s+minute\s+time_hour/;

		await openAsPlaintext(app, fileName, searchString);
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

async function openAsPlaintext(app: Application, fileName: string, searchString: string | RegExp) {
	await app.workbench.quickaccess.openDataFile(join(app.workspacePathOrFolder, 'data-files', 'flights', fileName));
	await app.workbench.quickaccess.runCommand('workbench.action.positronDataExplorer.openAsPlaintext');

	const openAnyway = app.code.driver.page.getByText("Open Anyway");
	if (await openAnyway.isVisible({ timeout: 1000 })) {
		await openAnyway.click();
	}

	await app.workbench.editor.waitForEditorContents(fileName, (contents) => {
		if (searchString instanceof RegExp) {
			return contents.search(searchString) !== -1;
		} else {
			return contents.includes(searchString);
		}
	});
}
