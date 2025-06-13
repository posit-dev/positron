/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';
import { expectedColumnNames, pyColumnComparison } from './helpers/expected_columns';

test.use({
	suiteId: __filename
});

// Note that expecting modal popup (filter columns) to be out helps ensure nothing weird happens after double-escaping.
test.describe('Verify data columns using UI', { tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER] }, () => {
	test.afterEach(async ({ app, page }) => {
		await page.getByRole('button', { name: 'Select Column' }).focus();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await expect(page.locator('.positron-modal-popup')).toHaveCount(0);
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Verify data columns - Python', async function ({ app, python, openDataFile }) {
		await openDataFile('data-files/data_explorer/data_columns.csv');
		await app.workbench.dataExplorer.addFilterButton.click();
		await app.workbench.dataExplorer.selectColumnButton.click();
		await app.workbench.dataExplorer.verifyColumnHeaders(expectedColumnNames);
	});

	test('Verify data columns - R', async function ({ app, r, openDataFile }) {
		await openDataFile('data-files/data_explorer/data_columns.csv');
		await app.workbench.dataExplorer.addFilterButton.click();
		await app.workbench.dataExplorer.selectColumnButton.click();
		await app.workbench.dataExplorer.verifyColumnHeaders(expectedColumnNames);
	});
});

// R is not being included here due to `check_names` default R function.
// Although `check_names` can be set to false, it makes things very complicated with column names with quotes, among other issues.
test.describe('Verify data columns using data frame through console (with Python only)', { tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER] }, () => {
	test.afterEach(async ({ app }) => {
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});

	test('Python can read CSV and verify column names', async ({ app, python }) => {
		await app.workbench.console.pasteCodeToConsole(pyColumnComparison);
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.waitForConsoleContents('True');
	});
});
