/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

const NOTEBOOK_PATH = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Open & Save', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Switching between VS Code and Positron notebook editors works correctly', async function ({ app, hotKeys, settings }) {
		const { notebooks, notebooksVscode, notebooksPositron } = app.workbench;

		// Positron notebooks are enabled by default for notebooks-positron tests
		// Verify that opening a notebook uses the Positron editor
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
		await notebooksPositron.expectToBeVisible();

		// Switch to VS Code notebook editor and verify it works
		await hotKeys.closeAllEditors();
		await notebooksPositron.disablePositronNotebooks(settings);

		await notebooks.openNotebook(NOTEBOOK_PATH);
		await notebooksVscode.expectToBeVisible();

		// Switch back to Positron notebook editor and verify it works
		await hotKeys.closeAllEditors();
		await notebooksPositron.enablePositronNotebooks(settings);

		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
		await notebooksPositron.expectToBeVisible();
	});


	test('Positron notebooks can open new untitled notebooks and saving works properly', { tag: [tags.WEB] },
		async function ({ app, runCommand, cleanup }) {
			const { notebooks, notebooksPositron, quickInput, editors } = app.workbench;

			// Create a new untitled notebook
			await notebooks.createNewNotebook();
			await notebooksPositron.expectToBeVisible();

			// New notebooks should automatically be named "Untitled-1.ipynb" by default
			await editors.waitForActiveTab('Untitled-1.ipynb', false);

			// Test save dialog functionality - save with a name that doesn't include .ipynb extension
			// The enhanced save dialog should automatically handle extension enforcement
			await runCommand('workbench.action.files.saveAs', { keepOpen: true });
			await quickInput.waitForQuickInputOpened();

			// Type filename without extension to test automatic extension handling
			const baseFileName = `saved-positron-notebook-${Math.random().toString(36).substring(7)}`;
			await quickInput.type(path.join(app.workspacePathOrFolder, baseFileName));
			await quickInput.clickOkButton();

			// Verify the file was saved and the .ipynb extension was automatically added
			const expectedFileName = `${baseFileName}.ipynb`;
			await editors.waitForActiveTab(expectedFileName, false);
			await notebooksPositron.expectToBeVisible();

			// Keep the test workspace clean for subsequent test runs
			await cleanup.removeTestFiles([expectedFileName]);
		});

	test('Ghost editor issue: Positron notebook does not create duplicate VS Code notebook on reload with dirty notebook', async function ({ app, hotKeys }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// Create a new notebook (which starts dirty)
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();

		// Verify only the expected tab is open (new notebooks are named Untitled-N.ipynb)
		await editors.waitForTab(/^Untitled-\d+\.ipynb$/, true); // true = isDirty

		// Count tabs before reload (checking for multiple tabs with same file is the ghost editor symptom)
		const tabsBefore = app.code.driver.page.locator('.tabs-container div.tab');
		await expect(tabsBefore).toHaveCount(1);

		// Reload the window to simulate restart
		await hotKeys.reloadWindow(true);

		// After reload, check for the ghost editor issue
		// The bug would cause both a Positron notebook AND a VS Code notebook to be visible

		// Check tab count - should still be 1, not 2
		const tabsAfter = app.code.driver.page.locator('.tabs-container div.tab');
		await expect(tabsAfter).toHaveCount(1);

		// Verify that the Positron notebook is visible
		await notebooksPositron.expectToBeVisible();

		// Verify that the VS Code notebook is NOT visible (this is the ghost editor we're trying
		const positronNotebookElements = app.code.driver.page.locator('.positron-notebook');
		const vscodeNotebookElements = app.code.driver.page.locator('.notebook-editor');

		// Should have only one notebook editor, and it should be the Positron one
		await expect(positronNotebookElements).toHaveCount(1);
		await expect(vscodeNotebookElements).toHaveCount(0);

		// Additional verification: ensure the active tab is still the restored untitled notebook
		await editors.waitForActiveTab(/^Untitled-\d+\.ipynb$/, true); // true = isDirty
	});
});
