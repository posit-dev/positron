/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';
test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Search', {
	tag: [tags.SEARCH, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async ({ app, settings }) => {
		const { notebooksPositron } = app.workbench;

		// Enable Positron Notebooks and open bitmap notebook
		await notebooksPositron.enablePositronNotebooks(settings);
		const notebookPath = path.join('workspaces', 'pokemon', 'pokemon.ipynb');
		await notebooksPositron.openNotebook(notebookPath);
	});

	// test.afterEach(async function ({ app }) {
	// 	await app.workbench.search.clearSearchResults();
	// });

	test('Verify Basic Search', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.search('import');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 4 });

		// notes:
		// open a notebook with a variety of cells e.g. code cells with/without output, and a few markdown cells
		// press Cmd+F
		// type some text
		// verify that matches are decorated/highlighted in the expected places
		// click next match
		// verify that match is revealed and selected
		// maybe repeat above?
		// click previous match
		// verify that match is revealed and selected - this will fail if we have focus issues when navigating to a match, which I expect to be prone to regressions
		// press ESC
		// verify that find widget closes
		// verify that matches are no longer decorated/highlighted
	});
});
