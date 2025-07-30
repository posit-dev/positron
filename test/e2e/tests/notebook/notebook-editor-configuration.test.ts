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

	test('Verify default editor is VS Code notebook when no association is set', async function ({ app, settings }) {
		const { notebooks, notebooksVscode } = app.workbench;

		// Ensure no editor association is set for .ipynb files
		await settings.set({
			'workbench.editorAssociations': {}
		});

		// Open the notebook file and verify it opens as a VS Code notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});

	test.skip('Verify setting editor association to positron notebook opens positron notebook', async function ({ app, settings }) {
		// Skipped: Positron notebook editor is behind feature flag (positron.notebook.enabled=false by default)
		const { notebooks, notebooksPositron } = app.workbench;

		// Set default editor to Positron notebook
		await settings.set({
			'workbench.editorAssociations': {
				'*.ipynb': 'workbench.editor.positronNotebook'
			}
		});

		// Open the notebook file and verify it opens as a Positron notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();
	});

	test.skip('Verify reverting to default setting opens VS Code notebook again', async function ({ app, hotKeys, settings }) {
		// Skipped: Positron notebook editor is behind feature flag (positron.notebook.enabled=false by default)
		const { notebooks, notebooksVscode, notebooksPositron } = app.workbench;

		// First, set default editor to Positron notebook
		await settings.set({
			'workbench.editorAssociations': {
				'*.ipynb': 'workbench.editor.positronNotebook'
			}
		});

		// Open the notebook file and verify it opens as a Positron notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();

		// Revert default editor to VS Code notebook by removing the association
		await hotKeys.closeAllEditors();
		await settings.set({
			'workbench.editorAssociations': {}
		});

		// Open notebook again and verify it opens as a VS Code notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});
});

