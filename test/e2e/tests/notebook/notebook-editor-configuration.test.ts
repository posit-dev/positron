/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// Tests:
// - Start by creating a new notebook file that can be used for all tests. This Should have a single cell with print("test") in it
//     this is needed because the current positron editor does not support creating a _new_ notebook. (Make a note of this in the code.)
// There should be a helper function reports which notebook is open:
//    - If there is an element for generating code (as given by  <a class="action-label codicon codicon-sparkle" role="button" aria-label="Start Chat to Generate Code (⌘I)" tabindex="0"></a>) then we're in vscode notebooks.
//    - If there is a div with the class "positron-notebook" then we're in positron notebooks
//    - It's important this is a function that can be easily updated as dom structures may change.
// The tests should then test the following:
// 1. The default editor is VS Code notebook.
// 2. When the setting 'positron.notebooks.defaultEditor' is set to 'positron' then we open in a positron notebook
// 3. When we go back to the default value we can open the editor again and it's back to vscode.

test.describe('Notebook Editor Configuration', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {

	// test.beforeAll(async function ({ app, settings }) {
	// 	if (app.web) {
	// 		await settings.set({
	// 			'files.simpleDialog.enable': true,
	// 		});
	// 	}
	// });

	// test.beforeEach(async function ({ app, python, settings }) {
	// 	// Set up layout for notebook testing
	// 	await app.workbench.layouts.enterLayout('notebook');
	// });

	test.afterEach(async function ({ settings }) {
		// Reset the setting to default
		await settings.set({
			'positron.notebooks.defaultEditor': 'vscode'
		});
	});

	/**
	 * Helper function to detect if Positron notebook is open
	 * @param page The Playwright page object
	 */
	async function detectPositronNotebook(page: any): Promise<void> {
		const positronIndicator = page.locator('.positron-notebook').first();
		await positronIndicator.waitFor({ timeout: 5000 });
	}

	/**
	 * Helper function to detect if VS Code notebook is open
	 * @param page The Playwright page object
	 */
	async function detectVSCodeNotebook(page: any): Promise<void> {
		const vscodeIndicator = page.getByLabel(/Start Chat to Generate Code/).first();
		await vscodeIndicator.waitFor({ timeout: 5000 });
	}

	/**
	 * Helper function to get the test notebook file path
	 * Uses existing notebook at workspaces/bitmap-notebook/bitmap-notebook.ipynb
	 */
	function getTestNotebookPath(app: any): string {
		return path.join(app.workspacePathOrFolder, 'workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');
	}

	test('default editor is VS Code notebook', async function ({ app, page }) {
		// Get test notebook path
		const notebookPath = getTestNotebookPath(app);

		// Close the current editor to start fresh
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

		// Open the notebook file
		await app.workbench.notebooks.openNotebook(notebookPath, false);

		// Wait for VS Code notebook to load
		await detectVSCodeNotebook(page);
	});

	test('setting positron.notebooks.defaultEditor to positron opens positron notebook', async function ({ app, page, settings }) {
		// Set the setting to use Positron notebooks
		await settings.set({
			'positron.notebooks.defaultEditor': 'positron'
		});

		// Get test notebook path
		const notebookPath = getTestNotebookPath(app);

		// Close the current editor to start fresh
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

		// Open the notebook file
		await app.workbench.notebooks.openNotebook(notebookPath, false);

		// Wait for Positron notebook to load
		await detectPositronNotebook(page);
	});

	test('reverting to default setting opens VS Code notebook again', async function ({ app, page, settings }) {
		// First set to Positron
		await settings.set({
			'positron.notebooks.defaultEditor': 'positron'
		});

		// Get test notebook path
		const notebookPath = getTestNotebookPath(app);

		// Open in Positron first
		await app.workbench.notebooks.openNotebook(notebookPath, false);
		await detectPositronNotebook(page);

		// Close editor
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

		// Revert to default (VS Code)
		await settings.set({
			'positron.notebooks.defaultEditor': 'vscode'
		});

		// Open notebook again
		await app.workbench.notebooks.openNotebook(notebookPath, false);
		await detectVSCodeNotebook(page);
	});

});
