/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../tests/_test.setup';
import { capturePanel } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

/**
 * Screenshot: Data Explorer open with a DataFrame of flight data, with an active filter and summary panel open
 * Path: https://positron.posit.co/images/data-explorer.png
 */
test.describe('Release screenshots - Data Explorer', () => {
	test('main panel', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;

		// open the flights dataset in the data explorer
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files', 'flights', 'flights.parquet',
		);
		await executeCode('Python', `
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim());
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(true);
		await dataExplorer.waitForIdle();

		// apply a filter to the data explorer
		await dataExplorer.filters.add({ columnName: 'dep_time', condition: 'is not missing' });
		await dataExplorer.waitForIdle();

		// Sort by month descending. columnIndex is 1-based; month is column 2.
		await dataExplorer.grid.sortColumnBy(2, 'Sort Descending');
		await dataExplorer.waitForIdle();

		// Expand the arr_delay column profile in the summary panel.
		await dataExplorer.summaryPanel.expandColumnProfile(8);

		// capture screenshot
		await prepareForScreenshot(app, page);
		// .editor-group-container includes the tab strip ('Data: flights' tab)
		// plus the editor body. .positron-data-explorer alone starts below the
		// tab strip and crops it off.
		await capturePanel(page.locator('.part.editor .editor-group-container'), 'data-explorer.png');
	});
});
