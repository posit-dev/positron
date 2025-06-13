/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expectedColumnNames } from './helpers/expected_columns';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Column Names', { tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER] }, () => {

	test('Verify data columns - Python', async function ({ app, python, openDataFile }) {
		await openDataFile('data-files/data_explorer/data_columns.csv');
		await app.workbench.dataExplorer.addFilterButton.click();
		await app.workbench.dataExplorer.selectColumnButton.click();
		await app.workbench.dataExplorer.verifyColumnHeaders(expectedColumnNames);
	});

});

/* Add this after test.describe if there is a need to escape from the filter and delete all sessions for clean-up.
	test.afterEach(async ({ app, page }) => {
		await page.getByRole('button', { name: 'Select Column' }).focus();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await expect(page.locator('.positron-modal-popup')).toHaveCount(0);
		await app.workbench.console.clearButton.click();
		await app.workbench.sessions.deleteAll();
	});
*/
