/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Untitled naming', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Creating multiple untitled notebooks increments the name suffix', async function ({ app }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// TEMP DIAGNOSTIC for #13561 -- surface renderer console logs in test output
		app.code.driver.currentPage.on('console', msg => {
			if (msg.text().includes('[13561]')) {
				console.log('[renderer]', msg.text());
			}
		});

		// First untitled notebook is named Untitled-1.ipynb
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);

		// Subsequent untitled notebooks increment the suffix instead of
		// reusing Untitled-1.ipynb (https://github.com/posit-dev/positron/issues/13561)
		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-2.ipynb', true);

		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-3.ipynb', true);
	});

	test('Untitled names keep incrementing after a window reload restores a dirty notebook', async function ({ app, hotKeys }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// TEMP DIAGNOSTIC for #13561 -- surface renderer console logs in test output
		const attachLogger = () => app.code.driver.currentPage.on('console', msg => {
			if (msg.text().includes('[13561]')) {
				console.log('[renderer]', msg.text());
			}
		});
		attachLogger();

		// Create a dirty untitled notebook then reload the window so it is
		// restored from a working copy backup
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);

		await hotKeys.reloadWindow(true);
		attachLogger(); // page changed after reload
		await editors.waitForActiveTab('Untitled-1.ipynb', true);
		await notebooksPositron.expectToBeVisible();

		// A new untitled notebook must not reuse the restored notebook's name
		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-2.ipynb', true);
	});

	test('VS Code editor: creating multiple untitled notebooks increments the name suffix', async function ({ app, settings }) {
		const { notebooks, notebooksVscode, notebooksPositron, editors } = app.workbench;

		// TEMP DIAGNOSTIC for #13561 -- surface renderer console logs in test output
		app.code.driver.currentPage.on('console', msg => {
			if (msg.text().includes('[13561]')) {
				console.log('[renderer]', msg.text());
			}
		});

		await notebooksPositron.disablePositronNotebooks(settings);

		await notebooks.createNewNotebook();
		await notebooksVscode.expectToBeVisible();
		await editors.waitForActiveTab('Untitled-1.ipynb', true);

		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-2.ipynb', true);

		await notebooks.createNewNotebook();
		await editors.waitForActiveTab('Untitled-3.ipynb', true);
	});
});
