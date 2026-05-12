/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../tests/_test.setup';
import { capturePanel } from './helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

/**
 * Img Path: https://positron.posit.co/images/data-explorer.png
 */
test.describe('Release Screenshots - Data Explorer', () => {
	test('Release Screenshot - data-explorer.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;

		// open the flights dataset in the data explorer
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(true);
		await dataExplorer.waitForIdle();

		// apply filter: dep_time is not missin
		await dataExplorer.filters.add({
			columnName: 'dep_time',
			condition: 'is not missing',
		});
		await dataExplorer.waitForIdle();

		// apply filter: month is greater than 1
		await dataExplorer.filters.add({
			columnName: 'month',
			condition: 'is greater than',
			value: '1',
		});
		await dataExplorer.waitForIdle();

		// Sort by month descending. columnIndex is 1-based; month is column 2.
		await dataExplorer.grid.sortColumnBy(2, 'Sort Descending');
		await dataExplorer.waitForIdle();

		// Expand the arr_delay column profile in the summary panel.
		await dataExplorer.summaryPanel.expandColumnProfile(8);

		// capture screenshot
		await prepareForScreenshot(app, page);
		await capturePanel(
			page,
			page.locator('.part.editor .editor-group-container'),
			'data-explorer.png',
		);
	});
});
