/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';

const NOTEBOOK_PATH = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');

test.use({
	suiteId: __filename
});

test.describe('Notebook Editor Configuration', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Verify default editor is VS Code notebook', async function ({ app, settings }) {
		const { notebooks, notebooksVscode } = app.workbench;

		// Set default editor to VS Code notebook
		await settings.set({
			'positron.notebooks.defaultEditor': 'vscode'
		});

		// Open the notebook file and verify it opens as a VS Code notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});

	test('Verify setting `positron.notebooks.defaultEditor` to `positron` opens positron notebook', async function ({ app, settings }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// Set default editor to Positron notebook
		await settings.set({
			'positron.notebooks.defaultEditor': 'positron'
		});

		// Open the notebook file and verify it opens as a Positron notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();
	});

	test('Verify reverting to default setting opens VS Code notebook again', async function ({ app, hotKeys, settings }) {
		const { notebooks, notebooksVscode, notebooksPositron } = app.workbench;

		// First, set default editor to Positron notebook
		await settings.set({
			'positron.notebooks.defaultEditor': 'positron'
		});

		// Open the notebook file and verify it opens as a Positron notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();

		// Revert default editor to VS Code notebook
		await hotKeys.closeAllEditors();
		await settings.set({
			'positron.notebooks.defaultEditor': 'vscode'
		});

		// Open notebook again and verify it opens as a VS Code notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});
});

