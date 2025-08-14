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
		const dataExplorer = app.workbench.dataExplorer;
		await openDataFile('data-files/data_explorer/data_columns.csv');

		await dataExplorer.filters.addFilterButton.click();
		await dataExplorer.filters.selectColumnButton.click();
		await dataExplorer.grid.verifyColumnHeaders(expectedColumnNames);
	});

});
