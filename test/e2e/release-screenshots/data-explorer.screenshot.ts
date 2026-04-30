/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

const LOAD_FLIGHTS = `
import pandas as pd
import os
flights = pd.read_parquet(os.path.join(os.getcwd(), 'data-files', 'flights', 'flights.parquet'), engine='pyarrow')
`.trim();

test.describe('Release screenshots - Data Explorer', () => {
	test('main panel', async ({ app, page, openFolder, executeCode, python }) => {
		// Reproduces the hero shot at https://positron.posit.co/data-explorer.html:
		// NYC flights DataFrame opened in a maximized Data Explorer with the
		// Summary panel visible, a "dep_time is not missing" filter applied,
		// month sorted descending, and arr_delay's column profile expanded.
		test.slow();
		const { dataExplorer, variables } = app.workbench;

		await openFolder('qa-example-content/workspaces/nyc-flights-data-py');
		await app.workbench.console.waitForReady('>>>', 30000);

		await executeCode('Python', LOAD_FLIGHTS);
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
