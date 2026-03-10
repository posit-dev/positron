/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Autocomplete with Notebook Console', {
	tag: [tags.CONSOLE, tags.EDITOR, tags.NOTEBOOKS]
}, () => {

	test.afterEach(async function ({ hotKeys, settings }) {
		await settings.remove([
			'console.showNotebookConsoleActions',
			'console.showNotebookConsoles',
			'positron.quarto.inlineOutput.enabled',
			'workbench.editor.enablePreview',
		]);
		await hotKeys.closeAllEditors();
	});

	test('Python - Autocomplete in script works after opening notebook console', async function ({ app, runCommand, openFile, sessions, hotKeys, settings }) {
		const { editors, console, notebooks } = app.workbench;
		const page = app.code.driver.page;
		const keyboard = page.keyboard;

		await test.step('Enable notebook console actions', async () => {
			await settings.set(
				{ 'console.showNotebookConsoleActions': true },
				{ reload: true, waitMs: 1000 }
			);
		});

		// Start a Python console session and import pandas
		await sessions.start(['python']);
		await hotKeys.closeSecondarySidebar();
		await console.typeToConsole('import pandas as pd', true, 0);
		await sessions.expectAllSessionsToBeReady();

		await test.step('Open a Python script and verify autocomplete works initially', async () => {
			// Open an existing Python file from the workspace
			await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
			await editors.waitForEditorFocus('flights-data-frame.py');

			// Type at end of file to trigger autocomplete
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('pd.DataF', { delay: 250 });
			await editors.expectSuggestionListCount(1);
			await keyboard.press('Escape');
		});

		await test.step('Create notebook, execute a cell, and open its console', async () => {
			await notebooks.createNewNotebook();
			await notebooks.selectInterpreter('Python');

			// Execute a cell to start the kernel session
			await notebooks.addCodeToCellAtIndex(0, 'print("hello")');
			await notebooks.executeCodeInCell();

			// Show the notebook console
			await runCommand('workbench.action.positronConsole.showNotebookConsole');

			// Click on the notebook console tab to trigger the foreground session change
			await sessions.select('Untitled-1.ipynb');
		});

		await test.step('Switch back to script and verify autocomplete still works', async () => {
			// Switch back to the Python script tab
			await editors.selectTab('flights-data-frame.py');

			// Go to end of file and add a new line for autocomplete
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('pd.DataF', { delay: 250 });

			// Autocomplete should still work after the notebook console was opened
			await expect(async () => {
				await expect(editors.suggestionList).toHaveCount(1, { timeout: 5000 });
			}).toPass({ timeout: 30000 });
		});
	});

	test('R - Autocomplete in script works after opening notebook console', {
		tag: [tags.ARK]
	}, async function ({ app, runCommand, openFile, sessions, hotKeys, settings }) {
		const { editors, console, notebooks } = app.workbench;
		const page = app.code.driver.page;
		const keyboard = page.keyboard;

		await test.step('Enable notebook console actions', async () => {
			await settings.set(
				{ 'console.showNotebookConsoleActions': true },
				{ reload: true, waitMs: 1000 }
			);
		});

		// Start an R console session and load arrow
		await sessions.start(['r']);
		await hotKeys.closeSecondarySidebar();
		await console.typeToConsole('library(arrow)', true, 0);
		await sessions.expectAllSessionsToBeReady();

		await test.step('Open an R script and verify autocomplete works initially', async () => {
			// Open an existing R file from the workspace
			await openFile(join('workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
			await editors.waitForEditorFocus('flights-data-frame.r');

			// Type at end of file to trigger autocomplete
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('read_p', { delay: 250 });
			await editors.expectSuggestionListCount(4);
			await keyboard.press('Escape');
		});

		await test.step('Create notebook, execute a cell, and open its console', async () => {
			await notebooks.createNewNotebook();
			await notebooks.selectInterpreter('R');

			// Execute a cell to start the kernel session
			await notebooks.addCodeToCellAtIndex(0, 'print("hello")');
			await notebooks.executeCodeInCell();

			// Show the notebook console
			await runCommand('workbench.action.positronConsole.showNotebookConsole');

			// Click on the notebook console tab to trigger the foreground session change
			await sessions.select('Untitled-1.ipynb');
		});

		await test.step('Switch back to script and verify autocomplete still works', async () => {
			// Switch back to the R script tab
			await editors.selectTab('flights-data-frame.r');

			// Go to end of file and add a new line for autocomplete
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('read_p', { delay: 250 });

			// Autocomplete should still work after the notebook console was opened
			await expect(async () => {
				await expect(editors.suggestionList).toHaveCount(4, { timeout: 5000 });
			}).toPass({ timeout: 30000 });
		});
	});

	test('R - Autocomplete in Quarto uses Quarto LSP after switching to console', {
		tag: [tags.ARK, tags.QUARTO]
	}, async function ({ app, runCommand, openFile, sessions, hotKeys, settings }) {
		const { editors, inlineQuarto } = app.workbench;
		const page = app.code.driver.page;
		const keyboard = page.keyboard;
		const suggestionList = page.locator('.suggest-widget .monaco-list-row');

		await test.step('Enable inline output and notebook consoles', async () => {
			await settings.set({
				'positron.quarto.inlineOutput.enabled': true,
				'console.showNotebookConsoles': true,
				'workbench.editor.enablePreview': false,
			}, { reload: true, waitMs: 1000 });
		});

		// Start an R console session
		const [rSession] = await sessions.start(['r']);
		await hotKeys.closeSecondarySidebar();
		await sessions.expectAllSessionsToBeReady();

		await test.step('Open Quarto file, run cell, and keep file open', async () => {
			// Open the simple R rmd file - it defines x, y, and df
			await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
			await editors.waitForActiveTab('simple_r.rmd');
			await inlineQuarto.expectKernelStatusVisible();

			// Run the cell to start the Quarto kernel session and define df
			await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });

			// Re-focus the file in the editor after inline output
			await editors.selectTab('simple_r.rmd');
		});

		await test.step('Switch to Quarto console then back to R console', async () => {
			// Select the Quarto console tab to make it the foreground
			await sessions.select('simple_r.rmd');

			// Now switch back to the R console tab - this makes the
			// console session the foreground, which is the key trigger
			// for the bug
			await sessions.select(rSession.id);
		});

		await test.step('Type in Quarto and verify completions use Quarto LSP', async () => {
			// Switch back to the Quarto file in the editor
			await editors.selectTab('simple_r.rmd');

			// Go to line 11 (df <- data.frame(x, y)), press End to go
			// to end of line, Enter to create a new line inside the
			// code block, then type df$ to trigger completions.
			// If the Quarto LSP is active, df is known and we should
			// see column completions (x, y).
			// If the console LSP is wrongly active, df does not exist
			// in the console session, so no column completions.
			await inlineQuarto.gotoLine(11);
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('df$', { delay: 250 });

			// Explicitly trigger completions
			await expect(async () => {
				await keyboard.press('Control+Space');
				await expect(suggestionList.first()).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout: 30000 });

			// Verify we see the data frame column names
			const suggestWidget = page.locator('.suggest-widget');
			await expect(suggestWidget.getByLabel(/^x,/)).toBeVisible();
		});
	});
});
