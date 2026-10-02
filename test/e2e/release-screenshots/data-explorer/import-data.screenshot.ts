/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { join } from 'path';
import { Page } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { captureRegion } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { Application } from '../../infra';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

// The workbook is copied to the workspace root so the generated code reads it by
// a short path that wraps cleanly in the dialog's code preview. The copy takes the
// English spelling so the screenshot does not look like a typo to readers.
const SOURCE_WORKBOOK = join('data-files', 'supermarkt_sales', 'supermarkt_sales.xlsx');
const WORKBOOK_NAME = 'supermarket_sales.xlsx';

test.afterEach(async ({ app, hotKeys }) => {
	await hotKeys.closeAllEditors();
	await fs.rm(join(app.workspacePathOrFolder, WORKBOOK_NAME), { force: true });
});

// The dialog's corners are rounded (5px), so a crop to its bounding box picks up
// slivers of the workbench behind it. Inset the crop past the corners and border.
const DIALOG_INSET = 3;

async function captureDialog(app: Application, page: Page, filename: string): Promise<void> {
	const box = await app.workbench.dynamicModals.dialogBox.boundingBox();
	if (!box) {
		throw new Error(`Could not measure the Import Data dialog for ${filename}`);
	}
	await captureRegion(page, filename, {
		x: box.x + DIALOG_INSET,
		y: box.y + DIALOG_INSET,
		width: box.width - DIALOG_INSET * 2,
		height: box.height - DIALOG_INSET * 2,
	});
}

test.describe('Release Screenshots - Data Explorer Import Data', () => {
	/**
	 * Img Path: https://positron.posit.co/images/import-data.png
	 *
	 * The Import Data dialog on its own, opened over an Excel file with the
	 * Python (pandas) importer selected.
	 */
	test('Release Screenshot - import-data.png', async ({ app, page, openDataFile, python }) => {
		const { dataExplorer } = app.workbench;

		// copy the workbook to the workspace root and open it in the Data Explorer
		await fs.copyFile(
			join(app.workspacePathOrFolder, SOURCE_WORKBOOK),
			join(app.workspacePathOrFolder, WORKBOOK_NAME),
		);
		await openDataFile(WORKBOOK_NAME);
		await dataExplorer.waitForIdle();

		// open the Import Data dialog with pandas selected
		await dataExplorer.editorActionBar.clickButton('Import Data');
		await dataExplorer.importDataModal.expectToBeVisible();
		await dataExplorer.importDataModal.selectPackage('Python (pandas)');

		// a short variable name keeps the read_excel() call on one line in the code preview
		await dataExplorer.importDataModal.setVariableName('sales');
		await dataExplorer.importDataModal.expectCodeToContain(`sales = pd.read_excel("${WORKBOOK_NAME}"`);

		// capture screenshot, with focus off the input so it has no focus ring
		await dataExplorer.importDataModal.variableNameInput.blur();
		await prepareForScreenshot(app, page);
		await captureDialog(app, page, 'import-data.png');
		await dataExplorer.importDataModal.clickCancel();
	});

	/**
	 * Img Path: https://positron.posit.co/images/import-data-filters-sorts.png
	 *
	 * The Import Data dialog opened over a filtered and sorted CSV, with the
	 * R (readr) importer selected and "Include current filters and sorts"
	 * checked so the generated code carries the dplyr pipeline.
	 */
	test('Release Screenshot - import-data-filters-sorts.png', async ({ app, page, openDataFile, r }) => {
		const { dataExplorer } = app.workbench;

		// open the CSV in the Data Explorer
		await openDataFile(join('data-files', 'flights', 'flights.csv'));
		await dataExplorer.waitForIdle();

		// apply filter: dep_time is not missing
		await dataExplorer.filters.add({ columnName: 'dep_time', condition: 'is not missing' });
		await dataExplorer.waitForIdle();

		// sort by month descending. columnIndex is 1-based; the CSV's unnamed index
		// column comes first, so month is column 3.
		await dataExplorer.grid.sortColumnBy(3, 'Sort Descending');
		await dataExplorer.waitForIdle();

		// open the Import Data dialog with readr selected and the view included
		await dataExplorer.editorActionBar.clickButton('Import Data');
		await dataExplorer.importDataModal.expectToBeVisible();
		await dataExplorer.importDataModal.selectPackage('R (readr)');
		await dataExplorer.importDataModal.setIncludeFiltersAndSorts(true);
		await dataExplorer.importDataModal.expectCodeToContain('library(dplyr)');
		await dataExplorer.importDataModal.expectCodeToContain('arrange(desc(month))');

		// capture screenshot
		await prepareForScreenshot(app, page);
		await captureDialog(app, page, 'import-data-filters-sorts.png');
		await dataExplorer.importDataModal.clickCancel();
	});
});
