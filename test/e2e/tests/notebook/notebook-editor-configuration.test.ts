/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags, WorkerFixtures } from '../_test.setup';

const NOTEBOOK_PATH = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');

test.use({
	suiteId: __filename
});

/**
 * Helper function to set notebook editor associations
 * @param settings - The settings fixture
 * @param editor - 'positron' to use Positron notebook editor, 'default' to clear associations
 * @param waitMs - The number of milliseconds to wait for the settings to be applied
 */
async function setNotebookEditor(
	settings: WorkerFixtures['settings'],
	editor: 'positron' | 'default',
	waitMs = 250
) {
	const editorAssociations = {
		'workbench.editorAssociations': editor === 'positron'
			? { '*.ipynb': 'workbench.editor.positronNotebook' }
			: {}
	};

	await settings.set(editorAssociations, { waitMs });
}

test.describe('Notebook Editor Configuration', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {

	test.beforeEach(async function ({ settings }) {
		// Reset editor associations to default state before each test
		await setNotebookEditor(settings, 'default');
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	// After all tests, reset editor associations to default state
	test.afterAll(async function ({ settings }) {
		await setNotebookEditor(settings, 'default');
	});

	test('Verify default editor is VS Code notebook when no association is set', async function ({ app }) {
		const { notebooks, notebooksVscode } = app.workbench;
		// Open the notebook file and verify it opens as a VS Code notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});

	test('Verify setting editor association to positron notebook opens positron notebook', async function ({ app, settings }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// Set default editor to Positron notebook
		await setNotebookEditor(settings, 'positron');

		// Open the notebook file and verify it opens as a Positron notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();
	});

	test('Verify reverting to default setting opens VS Code notebook again', async function ({ app, hotKeys, settings }) {
		const { notebooks, notebooksVscode, notebooksPositron } = app.workbench;

		// First, set default editor to Positron notebook
		await setNotebookEditor(settings, 'positron');

		// Open the notebook file and verify it opens as a Positron notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();

		// Revert default editor to VS Code notebook by removing the association
		await hotKeys.closeAllEditors();
		await setNotebookEditor(settings, 'default');

		// Open notebook again and verify it opens as a VS Code notebook
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});

	test('Verify newly created notebook respects positron editor setting', async function ({ app, settings }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// Set default editor to Positron notebook
		await setNotebookEditor(settings, 'positron');

		// Create a new untitled notebook and verify it opens as a Positron notebook
		// This tests the fix in PR #8608 - newly created notebooks should respect editor associations
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
	});

	test('Verify newly created notebook opens as VS Code notebook with default settings', async function ({ app }) {
		const { notebooks, notebooksVscode } = app.workbench;

		// Create a new untitled notebook and verify it opens as a VS Code notebook
		// When no editor association is set, new notebooks should open in the default VS Code editor
		await notebooks.createNewNotebook();
		await notebooksVscode.expectToBeVisible();
	});
});
