/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// Import Data turns a file the Data Explorer is viewing into a dataframe in a session. This
// exercises the whole chain: the action, the importer registry, the extension activation, the
// ext-host bridge, the language's generator, and console execution, which no unit test can reach.
// One case per language, because each language registers its importer from its own extension.
test.describe('Data Explorer - Import Data', {
	tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER, tags.DUCK_DB]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python Pandas - Verify importing a CSV creates a dataframe in the session', async function ({ app, openDataFile, python }) {
		const { dataExplorer, variables } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));
		await dataExplorer.waitForIdle();

		await dataExplorer.editorActionBar.clickButton('Import Data');
		await dataExplorer.importDataModal.expectToBeVisible();

		// The generated code loads this file into a variable named after it.
		await dataExplorer.importDataModal.expectCodeToContain('pd.read_csv');
		await dataExplorer.importDataModal.expectCodeToContain('small_file');

		await dataExplorer.importDataModal.clickImport();

		// The file has a header row and 10 data rows, so pandas reports 10 rows.
		await variables.expectVariableToBe('small_file', /10 rows/);
	});

	test('R readr - Verify importing a CSV creates a dataframe in the session', async function ({ app, openDataFile, r }) {
		const { dataExplorer, variables } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));
		await dataExplorer.waitForIdle();

		await dataExplorer.editorActionBar.clickButton('Import Data');
		await dataExplorer.importDataModal.expectToBeVisible();

		await dataExplorer.importDataModal.selectPackage('R (readr)');

		// The generated code loads this file into a variable named after it.
		await dataExplorer.importDataModal.expectCodeToContain('library(readr)');
		await dataExplorer.importDataModal.expectCodeToContain('read_csv');
		await dataExplorer.importDataModal.expectCodeToContain('small_file');

		await dataExplorer.importDataModal.clickImport();

		// The file has a header row, 10 data rows, and 10 columns, which is how readr reads it.
		await variables.expectVariableToBe('small_file', /10 rows x 10 columns/);
	});
});
