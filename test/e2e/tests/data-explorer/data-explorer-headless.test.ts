/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';
import { Application, TestTags } from '../../infra';

test.use({
	suiteId: __filename
});

const testCases = [
	{ name: 'parquet', file: 'data-files/flights/flights.parquet', copyValue: '2013' },
	{ name: 'csv', file: 'data-files/flights/flights.csv', copyValue: '0' },
	{ name: 'gzipped csv', file: 'data-files/flights/flights.csv.gz', copyValue: '0' },
	{ name: 'tsv', file: 'data-files/flights/flights.tsv', copyValue: '0' },
	{ name: 'gzipped tsv', file: 'data-files/flights/flights.tsv.gz', copyValue: '0' },
	{ name: 'pipe csv', file: 'data-files/flights/flights_piped.csv', copyValue: '0' }
];

const plainTextTestCases = [
	{ name: 'csv', file: 'flights.csv', searchString: ',year,month,day,dep_time,sched_dep_time,dep_delay,arr_time,sched_arr_time,arr_delay,carrier,flight,tailnum,origin,dest,air_time,distance,hour,minute,time_hour' },
	{ name: 'tsv', file: 'flights.tsv', searchString: /\s+year\s+month\s+day\s+dep_time\s+sched_dep_time\s+dep_delay\s+arr_time\s+sched_arr_time\s+arr_delay\s+carrier\s+flight\s+tailnum\s+origin\s+dest\s+air_time\s+distance\s+hour\s+minute\s+time_hour/ },
	{ name: 'pipe csv', file: 'flights_piped.csv', searchString: '|year|month|day|dep_time|sched_dep_time|dep_delay|arr_time|sched_arr_time|arr_delay|carrier|flight|tailnum|origin|dest|air_time|distance|hour|minute|time_hour' }

];

test.describe('Headless Data Explorer', {
	tag: [tags.WEB, tags.DATA_EXPLORER, tags.DUCK_DB, tags.WIN]
}, () => {

	test.beforeEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('notebook'); // Make data explorer larger
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.dataExplorer.closeDataExplorer();
		await app.workbench.layouts.enterLayout('stacked'); //return to default layout
	});

	testCases.forEach(({ name, file, copyValue }) => {
		test(`Verify can open and view data with large ${name} file`, async function ({ app, openDataFile }) {
			await openDataFile(`${file}`);
			await app.workbench.editors.verifyTab(file.split('/').pop()!, { isVisible: true, isSelected: true });
			await verifyCopyFromCell(app, copyValue);
			await verifyDataIsPresent(app);
			await verifyPlainTextButtonInActionBar(app, file.endsWith('.csv') || file.endsWith('.tsv'));
		});
	});

	plainTextTestCases.forEach(({ name, file, searchString }) => {
		test(`Verify can open ${name} file as plaintext`,
			{ tag: [TestTags.EDITOR_ACTION_BAR] }, async function ({ app, openDataFile }) {
				await openDataFile(join(`data-files/flights/${file}`));
				await verifyPlainTextButtonInActionBar(app, true);
				await verifyCanOpenAsPlaintext(app, searchString);
			});
	});

	test(`Verify can open parquet decimal data`, async function ({ app, openDataFile }) {
		await openDataFile(`data-files/misc-parquet/decimal_types.parquet`);
		await app.workbench.editors.verifyTab('decimal_types.parquet', { isVisible: true, isSelected: true });
		await verifyCopyFromCell(app, '123456789012345.678');
		await expect(async () => {
			// Validate full grid by checking bottom right corner data
			await app.workbench.dataExplorer.clickLowerRightCorner();
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
			const lastRow = tableData.at(-2);
			const lastHour = lastRow!['decimal_no_scale'];
			expect(lastHour).toBe(`5555555555`);
		}).toPass();
	}
	);
});


// Helpers

async function verifyDataIsPresent(app: Application) {
	const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';

	await expect(async () => {
		// Validate full grid by checking bottom right corner data
		await app.workbench.dataExplorer.clickLowerRightCorner();
		const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();
		const lastRow = tableData.at(-1);
		const lastHour = lastRow!['time_hour'];
		expect(lastHour).toBe(LAST_CELL_CONTENTS);
	}).toPass();
}

async function verifyCanOpenAsPlaintext(app: Application, searchString: string | RegExp) {
	await app.workbench.editorActionBar.clickButton('Open as Plain Text File');

	// Check if the "Open Anyway" button is visible. This is needed on web only as it warns
	// that the file is large and may take a while to open. This is due to a vs code behavior and file size limit.
	const openAnyway = app.code.driver.page.getByText("Open Anyway");

	if (await openAnyway.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
		await openAnyway.click();
	}

	await expect(app.code.driver.page.getByText(searchString, { exact: true })).toBeVisible();
}

async function verifyPlainTextButtonInActionBar(app: Application, isVisible: boolean) {
	const openAsPlainTextInActionBar = app.code.driver.page.getByLabel('Open as Plain Text File');
	isVisible
		? await expect(openAsPlainTextInActionBar).toBeVisible()
		: await expect(openAsPlainTextInActionBar).not.toBeVisible();
}

async function verifyCopyFromCell(app: Application, value: string) {
	await expect(async () => {
		await app.code.driver.page.locator('#data-grid-row-cell-content-0-0 .text-container .text-value').click();
		await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
		const clipboardText = await app.workbench.clipboard.getClipboardText();
		expect(clipboardText).toBe(value);
	}).toPass();
}
