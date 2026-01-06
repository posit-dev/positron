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
	tag: [tags.POSITRON_NOTEBOOKS, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async ({ app, settings }) => {
		const { notebooksPositron } = app.workbench;

		// enable Positron Notebooks and open bitmap notebook
		await notebooksPositron.enablePositronNotebooks(settings);
		const notebookPath = path.join('workspaces', 'pokemon', 'pokemon.ipynb');
		await notebooksPositron.openNotebook(notebookPath);
	});

	test('Verify Basic Search', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// open search and search for 'import'
		await notebooksPositron.search('import');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 4 });
		await notebooksPositron.expectSearchDecorationCountToBe(4);

		// click next match
		await notebooksPositron.searchNext('button');
		await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });

		// enter for next match
		await notebooksPositron.searchNext('keyboard');
		await notebooksPositron.expectSearchCountToBe({ current: 3, total: 4 });

		// click previous match
		await notebooksPositron.searchPrevious();
		await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });

		// close search
		await notebooksPositron.searchClose('button');
		await notebooksPositron.expectSearchDecorationCountToBe(0);
	});
});
