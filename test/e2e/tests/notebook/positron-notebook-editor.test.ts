/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

const NOTEBOOK_PATH = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Open & Save', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'default',
			reload: true,
		});
	});

	test.beforeEach(async function ({ app, settings }) {
		// Reset editor associations to default state before each test
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'default',
		});
	});

	test.afterEach(async function ({ app, settings, hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Switching between VS Code and Positron notebook editors works correctly', async function ({ app, hotKeys, settings }) {
		const { notebooks, notebooksVscode, notebooksPositron } = app.workbench;

		// Verify default behavior - VS Code notebook editor should be used when no association is set
		// This tests the fallback behavior when positron.notebook.enabled=true but no explicit association exists
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();

		// Configure Positron as the default notebook editor
		// This sets workbench.editorAssociations to map *.ipynb files to the Positron notebook editor
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'positron',
		});

		// Verify that newly opened notebooks now use the Positron editor
		// The same notebook file should now open with the Positron interface instead of VS Code
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksPositron.expectToBeVisible();

		// Reset to default configuration and verify VS Code editor is used again
		// Close all editors first to ensure a clean state for the next test
		await hotKeys.closeAllEditors();
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'default',
		});

		// Confirm that removing the association restores VS Code notebook editor
		// This ensures the configuration change is properly applied and the fallback works
		await notebooks.openNotebook(NOTEBOOK_PATH, false);
		await notebooksVscode.expectToBeVisible();
	});


	test('Positron notebooks can open new untitled notebooks and saving works properly', async function ({ app, settings, runCommand, cleanup }) {
		const { notebooks, notebooksPositron, quickInput, editors } = app.workbench;

		// Configure Positron as the default notebook editor
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'positron',
		});

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

	test('Ghost editor issue: Positron notebook does not create duplicate VS Code notebook on reload with dirty notebook', async function ({ app, settings, hotKeys }) {
		const { notebooks, notebooksPositron, editors } = app.workbench;

		// Configure Positron as the default notebook editor
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'positron',
		});

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

		// Verify that the VS Code notebook is NOT visible (this is the ghost editor we're trying to prevent)\
		const positronNotebookElements = app.code.driver.page.locator('.positron-notebook');
		const vscodeNotebookElements = app.code.driver.page.locator('.notebook-editor');

		// Should have only one notebook editor, and it should be the Positron one
		await expect(positronNotebookElements).toHaveCount(1);
		await expect(vscodeNotebookElements).toHaveCount(0);

		// Additional verification: ensure the active tab is still the restored untitled notebook
		await editors.waitForActiveTab(/^Untitled-\d+\.ipynb$/, true); // true = isDirty
	});
});
