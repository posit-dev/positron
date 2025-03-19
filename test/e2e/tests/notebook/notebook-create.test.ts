/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebooks', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.describe('Python Notebooks', () => {
		test.beforeAll(async function ({ app, userSettings }) {
			if (app.web) {
				await userSettings.set([['files.simpleDialog.enable', 'true']]);
			}
		});

		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Verify code cell execution in notebook', async function ({ app }) {
			await app.workbench.notebooks.addCodeToCellAtIndex('eval("8**2")');
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('64');
		});

		test('Python - Verify markdown formatting in notebook', async function ({ app }) {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebooks.insertNotebookCell('markdown');
			await app.workbench.notebooks.typeInEditor(`## ${randomText} `);
			await app.workbench.notebooks.stopEditingCell();
			await app.workbench.notebooks.assertMarkdownText('h2', randomText);
		});

		test('Python - Save untitled notebook and preserve session', async function ({ app }) {
			// Ensure auxiliary sidebar is open to see variables pane
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

			// First, create and execute a cell to verify initial session
			await app.workbench.notebooks.addCodeToFirstCell('foo = "bar"');
			await app.workbench.notebooks.executeCodeInCell();

			// Verify the variable is in the variables pane
			await app.workbench.variables.expectVariableToBe('foo', "'bar'");

			// Save the notebook using the command
			await app.workbench.quickaccess.runCommand('workbench.action.files.saveAs', { keepOpen: true });
			await app.workbench.quickInput.waitForQuickInputOpened();
			// Generate a random filename
			const newFileName = `saved-session-test-${Math.random().toString(36).substring(7)}.ipynb`;

			await app.workbench.quickInput.type(path.join(app.workspacePathOrFolder, newFileName));
			await app.workbench.quickInput.clickOkButton();

			// Wait for the tab title to update with the new filename, indicating the save has completed
			await app.workbench.editors.waitForActiveTab(newFileName);

			// Verify the variables pane shows the correct notebook name
			await app.workbench.variables.expectRuntimeToBe('visible', newFileName);

			// Verify the variable still exists
			await app.workbench.variables.expectVariableToBe('foo', "'bar'");

			// Add a new cell
			await app.workbench.notebooks.insertNotebookCell('code');

			// Create a new variable using the now saved notebook
			// Add code to the new cell (using typeInEditor since addCodeToLastCell isn't available)
			await app.workbench.notebooks.focusNextCell();
			await app.workbench.notebooks.typeInEditor('baz = "baz"');

			// Execute the cell
			await app.workbench.notebooks.executeActiveCell();

			// Verify the variable is in the variables pane
			await app.workbench.variables.expectVariableToBe('baz', "'baz'");
		});
	});

	test.describe('R Notebooks', () => {
		test.beforeEach(async function ({ app, r }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('R');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('R - Verify code cell execution in notebook', async function ({ app }) {
			await app.workbench.notebooks.addCodeToCellAtIndex('eval(parse(text="8**2"))');
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('[1] 64');
		});

		test('R - Verify markdown formatting in notebook', async function ({ app }) {
			const randomText = Math.random().toString(36).substring(7);

			await app.workbench.notebooks.insertNotebookCell('markdown');
			await app.workbench.notebooks.typeInEditor(`## ${randomText} `);
			await app.workbench.notebooks.stopEditingCell();
			await app.workbench.notebooks.assertMarkdownText('h2', randomText);
		});
	});
});


