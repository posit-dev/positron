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

const SETUP_CODE = `
import pandas as pd

df = pd.DataFrame({
	'name':   ['Jai', 'Princi', 'Gaurav', 'Anuj', 'Ada', 'Linus', 'Grace'],
	'age':    [27, 24, 22, 32, 28, 30, 26],
	'city':   ['Delhi', 'Kanpur', 'Allahabad', 'Kannauj', 'London', 'Helsinki', 'New York'],
	'salary': [55000, 48000, 51000, 60000, 72000, 95000, 68000],
})
`.trim();

test.describe('Release screenshots - Data Explorer filter bar', () => {
	test('with active filter', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;

		await executeCode('Python', SETUP_CODE);
		await variables.doubleClickVariableRow('df');
		await dataExplorer.maximize(true);
		await dataExplorer.waitForIdle();

		await dataExplorer.filters.add({
			columnName: 'age',
			condition: 'is greater than or equal to',
			value: '25',
		});
		await dataExplorer.waitForIdle();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'filter-bar.png');
	});
});
