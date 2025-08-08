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
	waitMs = 800
) {
	await settings.set({
		'positron.notebook.enabled': true,
		'workbench.editorAssociations': editor === 'positron'
			? { '*.ipynb': 'workbench.editor.positronNotebook' }
			: {}
	}, { waitMs });
}

test.describe('Positron notebook opening and saving', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.notebook.enabled': true,
		}, { reload: true });
	});

	test.beforeEach(async function ({ settings }) {
		// Reset editor associations to default state before each test
		await setNotebookEditor(settings, 'default');
	});

	test.afterEach(async function ({ hotKeys, settings }) {
		await setNotebookEditor(settings, 'default');
		await hotKeys.closeAllEditors();
	});

	test('Switching between VS Code and Positron notebook editors works correctly', async function ({ app, python, hotKeys, settings }) {
		const { notebooks, notebooksVscode, notebooksPositron } = app.workbench;

		// Verify default behavior - VS Code notebook editor should be used when no association is set
		// This tests the fallback behavior when positron.notebook.enabled=true but no explicit association exists
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();

		// Configure Positron as the default notebook editor
		// This sets workbench.editorAssociations to map *.ipynb files to the Positron notebook editor
		await setNotebookEditor(settings, 'positron');

		// Verify that newly opened notebooks now use the Positron editor
		// The same notebook file should now open with the Positron interface instead of VS Code
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();

		// Reset to default configuration and verify VS Code editor is used again
		// Close all editors first to ensure a clean state for the next test
		await hotKeys.closeAllEditors();
		await setNotebookEditor(settings, 'default');

		// Confirm that removing the association restores VS Code notebook editor
		// This ensures the configuration change is properly applied and the fallback works
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});


	test('Positron notebooks can open new untitled notebooks and saving works properly', async function ({ app, settings, runCommand, cleanup }) {
		const { notebooks, notebooksPositron, quickInput, editors } = app.workbench;

		// Configure Positron as the default notebook editor
		await setNotebookEditor(settings, 'positron');

		// Create a new untitled notebook
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		// New notebooks should automatically be named "Untitled-1.ipynb" by default
		await editors.waitForActiveTab('Untitled-1.ipynb', false);

		// Save the notebook with a specific name
		await runCommand('workbench.action.files.saveAs', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		const newFileName = `saved-positron-notebook-${Math.random().toString(36).substring(7)}.ipynb`;
		await quickInput.type(path.join(app.workspacePathOrFolder, newFileName));
		await quickInput.clickOkButton();

		// Verify the editor tab now shows the new filename instead of "Untitled" and it is a positron notebook
		await editors.waitForActiveTab(newFileName, false);
		await notebooksPositron.expectToBeVisible();

		// Keep the test workspace clean for subsequent test runs
		await cleanup.removeTestFiles([newFileName]);
	});
});
