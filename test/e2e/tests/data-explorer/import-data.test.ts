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

	test('Variables pane button - Verify Import Data picks a file then opens the dialog', async function ({ app, python }) {
		const { dataExplorer, quickInput, variables } = app.workbench;

		await variables.clickImportData();

		// files.simpleDialog.enable is on in the e2e fixture settings, so the file picker is the
		// quick-input simple dialog rather than the OS-native one.
		await quickInput.waitForQuickInputOpened();
		await quickInput.type(join(app.workspacePathOrFolder, 'data-files', 'small_file.csv'));
		await quickInput.clickOkButton('Import');

		await dataExplorer.importDataModal.expectToBeVisible();
		await dataExplorer.importDataModal.expectCodeToContain('small_file');
		await dataExplorer.importDataModal.clickCancel();
	});

	test('Python Pandas - Verify filters and sorts carry into the imported dataframe', async function ({ app, openDataFile, python }) {
		const { dataExplorer, editorActionBar, variables } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));
		await dataExplorer.waitForIdle();

		// The view to reproduce: column0 > 40 keeps 5 of the 10 rows, plus a descending sort.
		await dataExplorer.filters.add({ columnName: 'column0', condition: 'is greater than', value: '40' });
		await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');

		// With a filter and sort applied, the retired Convert to Code button must not return.
		await editorActionBar.verifyButtonVisible('Convert to Code', false);

		await dataExplorer.editorActionBar.clickButton('Import Data');
		await dataExplorer.importDataModal.expectToBeVisible();
		await dataExplorer.importDataModal.setIncludeFiltersAndSorts(true);

		// The sort line proves the view reached the generator, and ascending=False proves the
		// descending direction survived; the row count below proves the filter executed. (Code
		// assertions avoid spaces: Monaco renders them as NBSP.)
		await dataExplorer.importDataModal.expectCodeToContain('sort_values');
		await dataExplorer.importDataModal.expectCodeToContain('ascending=False');

		await dataExplorer.importDataModal.clickImport();

		// 5 of the 10 data rows survive the column0 > 40 filter.
		await variables.expectVariableToBe('small_file', /5 rows/);
	});

	// The R generator emits a dplyr pipeline the unit tests only compare as a string. This is the
	// only place that pipeline is executed, so it is what catches code dplyr cannot run.
	test('R readr - Verify filters and sorts carry into the imported dataframe', async function ({ app, openDataFile, r }) {
		const { dataExplorer, variables } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));
		await dataExplorer.waitForIdle();

		// The view to reproduce: column0 > 40 keeps 5 of the 10 rows, plus a descending sort.
		await dataExplorer.filters.add({ columnName: 'column0', condition: 'is greater than', value: '40' });
		await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');

		await dataExplorer.editorActionBar.clickButton('Import Data');
		await dataExplorer.importDataModal.expectToBeVisible();
		await dataExplorer.importDataModal.selectPackage('R (readr)');
		await dataExplorer.importDataModal.setIncludeFiltersAndSorts(true);

		// dplyr is only imported once the view contributes verbs, and desc() proves the descending
		// direction survived. (Code assertions avoid spaces: Monaco renders them as NBSP.)
		await dataExplorer.importDataModal.expectCodeToContain('library(dplyr)');
		await dataExplorer.importDataModal.expectCodeToContain('arrange(desc(');

		await dataExplorer.importDataModal.clickImport();

		// 5 of the 10 data rows survive the column0 > 40 filter. A pipeline dplyr rejects leaves
		// the variable at 10 rows or absent entirely.
		await variables.expectVariableToBe('small_file', /5 rows x 10 columns/);
	});

	test('Kernel-backed explorer - Verify Convert to Code shows and Import Data does not', async function ({ app, executeCode, python }) {
		const { dataExplorer, editorActionBar, variables } = app.workbench;

		await executeCode('Python', 'import pandas as pd\ndf = pd.DataFrame({"a": [3, 1, 2]})');
		await variables.doubleClickVariableRow('df');
		await dataExplorer.waitForIdle();

		// Convert to Code requires a sort or filter; sorting also proves the button's own
		// precondition is met, so its visibility isolates the file-backed gating.
		await dataExplorer.grid.sortColumnBy(1, 'Sort Descending');

		await editorActionBar.verifyButtonVisible('Convert to Code', true);
		await editorActionBar.verifyButtonVisible('Import Data', false);
	});
});

// Electron only, with no WEB tag: right-clicking a file row in the Explorer tree opens no
// context menu at all in Positron Web, while other web surfaces (the Explorer title, the
// activity bar, the status bar) open one normally. That is a pre-existing web bug unrelated
// to Import Data, so the entry point is covered on Electron (Linux and Windows) instead.
test.describe('Data Explorer - Import Data from the Explorer context menu', {
	tag: [tags.WIN, tags.DATA_EXPLORER, tags.DUCK_DB]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Explorer context menu - Verify Import Data opens the dialog over the file', async function ({ app, python }) {
		const { contextMenu, dataExplorer, quickaccess } = app.workbench;
		const page = app.code.driver.currentPage;

		// Reveal data-files/small_file.csv in the Explorer.
		await quickaccess.runCommand('workbench.view.explorer');
		const folderRow = page.locator('.explorer-folders-view .monaco-list-row[aria-label="data-files"]');
		if (await folderRow.getAttribute('aria-expanded') === 'false') {
			await folderRow.locator('.monaco-tl-twistie').click();
		}
		const fileRow = page.locator('.explorer-folders-view .monaco-list-row[aria-label="small_file.csv"]');

		await contextMenu.triggerAndClick({
			menuTrigger: fileRow,
			menuItemLabel: 'Import Data...',
			menuTriggerButton: 'right'
		});

		// The command opens the file in the Data Explorer with the dialog over it.
		await dataExplorer.importDataModal.expectToBeVisible();
		await dataExplorer.importDataModal.expectCodeToContain('small_file');

		// The Python/R tests above already prove the import chain; stop at the dialog.
		await dataExplorer.importDataModal.clickCancel();
	});
});
