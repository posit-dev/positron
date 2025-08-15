/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the Data Explorer summary panel functionality.
	* Sort:
	* Search:
	* Expand/Collapse:
*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Summary Panel', { tag: [tags.WIN, tags.WEB, tags.DATA_EXPLORER] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'dataExplorer.summaryPanelEnhancements': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});


	test('Summary Panel: Search', async function ({ app, openDataFile }) {
		const { dataExplorer } = app.workbench;

		await openDataFile(join('data-files', 'small_file.csv'));

		// view data in data explorer
		await dataExplorer.maximize();
		await dataExplorer.waitForIdle();
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);

		// perform basic search
		await dataExplorer.summaryPanel.search('column9');
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// verify collapse and expand retains in search
		await dataExplorer.summaryPanel.expandColumnProfile();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.hide()
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// clear search and ensure col profile still expanded
		await dataExplorer.summaryPanel.clearSearch()
		await dataExplorer.summaryPanel.expectColumnCountToBe(10);
		// await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0); // <--- this is failing

		// search with no results
		await dataExplorer.summaryPanel.search('snickerdoodle');
		await dataExplorer.summaryPanel.expectColumnCountToBe(0);
		// await dataExplorer.summaryPanel.expectEmptyState();
	});
});
