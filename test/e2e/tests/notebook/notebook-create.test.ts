/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

let newFileName: string;

test.describe('Notebooks', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.describe('Python Notebooks', () => {
		test.beforeAll(async function ({ app, settings }) {
			if (app.web) {
				await settings.set({
					'files.simpleDialog.enable': true,
				});
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

		test.afterAll(async function ({ cleanup }) {
			await cleanup.removeTestFiles([newFileName]);
		});

		test('Python - Verify code cell execution in notebook', async function ({ app }) {
			await app.workbench.notebooks.addCodeToCellAtIndex(0, 'eval("8**2")');
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

		test('Python - Save untitled notebook and preserve session', async function ({ app, runCommand }) {
			const { notebooks, variables, layouts, quickInput } = app.workbench;

			// Ensure auxiliary sidebar is open to see variables pane
			await layouts.enterLayout('notebook');
			await runCommand('workbench.action.toggleAuxiliaryBar');

			// First, create and execute a cell to verify initial session
			await notebooks.addCodeToCellAtIndex(0, 'foo = "bar"');

			await expect.poll(
				async () => {
					try {
						await notebooks.executeCodeInCell();
						await variables.expectVariableToBe('foo', "'bar'", 2000);
						return true;
					} catch {
						return false;
					}
				},
				{
					timeout: 15_000,
					intervals: [2_000],
				}
			).toBe(true);

			// Save the notebook using the command
			await runCommand('workbench.action.files.saveAs', { keepOpen: true });
			await quickInput.waitForQuickInputOpened();

			// Generate a random filename
			newFileName = `saved-session-test-${Math.random().toString(36).substring(7)}.ipynb`;

			await quickInput.type(path.join(app.workspacePathOrFolder, newFileName));
			await quickInput.clickOkButton();

			// Verify the variables pane shows the correct notebook name
			await variables.expectRuntimeToBe('visible', newFileName);

			// Test Flake - seems like kernel might not be ready immediately after saving. Let's explicitly set it to see if this helps.
			await notebooks.selectInterpreter('Python');

			// Verify the variable still exists
			await variables.expectVariableToBe('foo', "'bar'");
			await notebooks.insertNotebookCell('code');

			// Create a new variable using the now saved notebook
			// Add code to the new cell (using typeInEditor since addCodeToLastCell isn't available)
			await notebooks.addCodeToCellAtIndex(1, 'baz = "baz"');
			await expect(async () => {
				await notebooks.selectCellAtIndex(1);
				await notebooks.executeActiveCell();
				await variables.expectVariableToBe('baz', "'baz'");
			}).toPass({ timeout: 15000 });
		});

		test('Python - Ensure LSP works across cells', async function ({ app }) {

			await app.workbench.notebooks.insertNotebookCell('code');

			await app.workbench.notebooks.addCodeToCellAtIndex(0, 'import torch');

			await app.workbench.notebooks.insertNotebookCell('code');

			await app.workbench.notebooks.addCodeToCellAtIndex(1, 'torch.rand(10)');

			// toPass block seems to be needed on Ubuntu
			await expect(async () => {
				await app.workbench.notebooks.hoverCellText(1, 'torch');

				const hoverTooltip = app.code.driver.page.getByRole('tooltip', {
					name: /module torch/,
				});

				await expect(hoverTooltip).toBeVisible();
				await expect(hoverTooltip).toContainText('The torch package contains');
			}).toPass({ timeout: 60000 });
		});
	});

	test.describe('R Notebooks', {
		tag: [tags.ARK]
	}, () => {
		test.beforeEach(async function ({ app, r }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('R');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('R - Verify code cell execution in notebook', async function ({ app }) {
			await app.workbench.notebooks.addCodeToCellAtIndex(0, 'eval(parse(text="8**2"))');
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
