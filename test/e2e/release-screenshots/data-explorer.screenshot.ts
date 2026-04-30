/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
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

		// Load the parquet via an absolute path so we don't need to openFolder
		// (which would reload the app and restart the interpreter). The data
		// file lives at the qa-example-content root, not inside the workspace
		// folder.
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

		await dataExplorer.filters.add({ columnName: 'dep_time', condition: 'is not missing' });
		await dataExplorer.waitForIdle();

		// Sort by month descending. columnIndex is 1-based; month is column 2.
		await dataExplorer.grid.sortColumnBy(2, 'Sort Descending');
		await dataExplorer.waitForIdle();

		// Expand the arr_delay column profile in the summary panel.
		// Column order in summary panel matches DataFrame order; arr_delay is
		// the 9th column (0-based index 8).
		await dataExplorer.summaryPanel.expandColumnProfile(8);

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'data-explorer.png');
	});
});
