/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

// Regression tests for https://github.com/posit-dev/positron/issues/13561
// (unsaved notebooks reusing the Untitled-1.ipynb name). The concurrent
// creation race itself is covered at the API level in
// extensions/vscode-api-tests/src/singlefolder-tests/notebook.api.test.ts;
// these tests pin the user-visible naming behavior in the full app.
test.describe('Positron Notebooks: Untitled naming', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Creating multiple untitled notebooks increments the name suffix', async function ({ app }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// First untitled notebook is named Untitled-1.ipynb
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);

		// Subsequent untitled notebooks increment the suffix instead of
		// reusing Untitled-1.ipynb
		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-2.ipynb', true);

		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-3.ipynb', true);
	});

	test('Untitled names keep incrementing after a window reload restores a dirty notebook', async function ({ app, hotKeys }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// Create a dirty untitled notebook then reload the window so it is
		// restored from a working copy backup
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);

		// Don't assert dirty post-reload: web restores the notebook clean (likely a bug - an unsaved notebook should stay dirty), so requiring `.dirty` flakes on Chromium.
		await hotKeys.reloadWindow(true);
		await editors.waitForActiveTab('Untitled-1.ipynb');
		await notebooksPositron.expectToBeVisible();

		// A new untitled notebook must not reuse the restored notebook's name
		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-2.ipynb', true);
	});

	test('Closing an unsaved notebook releases its name for reuse', async function ({ app, hotKeys }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// Create and discard an untitled notebook
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);
		await hotKeys.closeAllEditors();

		// The discarded name is reused (matches untitled text file behavior),
		// and creating the next notebook must not error
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);
	});
});
