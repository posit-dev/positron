/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename,
});

test.describe('Autocomplete with Notebook Console', {
	tag: [tags.CONSOLE, tags.EDITOR, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set(
			{
				'console.showNotebookConsoles': true,
				'console.showNotebookConsoleActions': true,
				'positron.quarto.inlineOutput.enabled': true,
				'workbench.editor.enablePreview': true,
			}
		);
	});

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Autocomplete in script works after opening notebook console', async function ({ app, page, openFile, sessions, python }) {
		const { editors, console, notebooksPositron } = app.workbench;
		const keyboard = page.keyboard;

		// Import pandas into Python session
		await console.typeToConsole('import pandas as pd', true, 0);
		await sessions.expectAllSessionsToBeReady();

		// Open an existing Python file from the workspace
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await editors.waitForEditorFocus('flights-data-frame.py');

		// Type at end of file to trigger autocomplete
		await keyboard.press('End');
		await keyboard.press('Enter');
		await keyboard.type('pd.DataF', { delay: 250 });
		await editors.expectSuggestionListCount(1);
		await keyboard.press('Escape');

		// Create new notebook and execute a cell
		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.executeCodeInCell();

		// Click on the notebook console tab to trigger the foreground session change
		await sessions.select('Untitled-1.ipynb');

		// Switch back to the Python script tab
		await editors.selectTab('flights-data-frame.py');

		// Go to end of file and add a new line for autocomplete
		await keyboard.press('End');
		await keyboard.press('Enter');
		await keyboard.type('pd.DataF', { delay: 250 });

		// Autocomplete should still work after the notebook console was opened
		await editors.expectSuggestionListCount(1, { retryTimeout: 30000 });
	});

	test('R - Autocomplete in script works after opening notebook console', {
		tag: [tags.ARK]
	}, async function ({ app, page, openFile, sessions, r }) {
		const { editors, console, notebooksPositron } = app.workbench;
		const keyboard = page.keyboard;

		// Load arrow in R session
		await console.typeToConsole('library(arrow)', true, 0);
		await sessions.expectAllSessionsToBeReady();

		// Open an existing R file from the workspace
		await openFile(join('workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await editors.waitForEditorFocus('flights-data-frame.r');

		// Type at end of file to trigger autocomplete
		await keyboard.press('End');
		await keyboard.press('Enter');
		await keyboard.type('read_p', { delay: 250 });
		await editors.expectSuggestionListCount(4);
		await keyboard.press('Escape');

		// Create a new notebook with one code cell and run it
		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.executeCodeInCell();

		// Click on the notebook console tab to trigger the foreground session change
		await sessions.select('Untitled-1.ipynb');

		// Switch back to the R script tab
		await editors.selectTab('flights-data-frame.r');

		// Go to end of file and add a new line for autocomplete
		await keyboard.press('End');
		await keyboard.press('Enter');
		await keyboard.type('read_p', { delay: 250 });

		// Autocomplete should still work after the notebook console was opened
		await editors.expectSuggestionListCount(4, { retryTimeout: 30000 });

	});

	test('R - Notebook console autocomplete uses notebook session not console session', {
		tag: [tags.ARK, tags.QUARTO]
	}, async function ({ app, page, openFile, sessions, r }) {
		const { console, inlineQuarto, editors } = app.workbench;
		const keyboard = page.keyboard;

		// Define a variable in the R console
		await console.executeCode('R', 'quux1234 <- faithful');
		await sessions.expectAllSessionsToBeReady();

		// Open a Quarto file and run a cell to start the notebook session
		await openFile(join('workspaces', 'quarto_inline_output', 'console_test.rmd'));
		await editors.waitForActiveTab('console_test.rmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell to start the Quarto kernel session
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });

		await test.step('Define a variable in the notebook session', async () => {
			// Define quux2345 by adding it to the existing code cell
			// and running it. This avoids typing into the console
			// input where the suggest widget can intercept Enter.
			await editors.selectTab('console_test.rmd');
			await inlineQuarto.gotoLine(11);
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('quux2345 <- mtcars', { delay: 0 });
			await inlineQuarto.runCurrentCell();
			await sessions.expectAllSessionsToBeReady();

			// Undo the file edit so later tests see the original file
			await keyboard.press('Meta+z');
			await keyboard.press('Meta+z');
		});

		await test.step('Verify notebook console autocomplete uses notebook session', async () => {
			// Switch to the notebook console
			await sessions.select('console_test.rmd');
			await console.waitForReady('>');

			// Clear the console input and type the prefix.
			await console.clearInput();
			await keyboard.type('quux', { delay: 250 });

			// Trigger completions and verify we see quux2345 (from the
			// notebook session). If the console LSP is incorrectly
			// active, we would see quux1234 instead.
			const suggestWidget = page.locator('.suggest-widget.visible');
			await expect(async () => {
				await keyboard.press('Control+Space');
				await expect(suggestWidget).toBeVisible({ timeout: 5000 });
				await expect(suggestWidget.getByLabel(/quux2345/)).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout: 30000 });
		});
	});

	test('R - Autocomplete in Quarto uses Quarto LSP after switching to console', {
		tag: [tags.ARK, tags.QUARTO]
	}, async function ({ app, page, openFile, sessions }) {
		const { editors, inlineQuarto } = app.workbench;
		const keyboard = page.keyboard;
		const suggestionList = page.locator('.suggest-widget .monaco-list-row');

		// Start an R console session
		const [rSession] = await sessions.start(['r']);
		await sessions.expectAllSessionsToBeReady();

		// Open the simple R rmd file - it defines x, y, and df
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
		await editors.waitForActiveTab('simple_r.rmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell to start the Quarto kernel session and define df
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });

		// Re-focus the file in the editor after inline output
		await editors.selectTab('simple_r.rmd');

		// Select the Quarto console tab to make it the foreground
		await sessions.select('simple_r.rmd');

		// Now switch back to the R console tab - this makes the
		// console session the foreground, which is the key trigger
		// for the bug
		await sessions.select(rSession.id);

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

	test('Python - Notebook console autocomplete uses notebook session not console session', {
		tag: [tags.QUARTO]
	}, async function ({ app, page, openFile, sessions, python }) {
		const { console, inlineQuarto, editors } = app.workbench;
		const keyboard = page.keyboard;

		// Define a variable in the Python console
		await console.executeCode('Python', 'quux1234 = 42');
		await sessions.expectAllSessionsToBeReady();

		// Open a Quarto file and run a cell to start the notebook session
		await openFile(join('workspaces', 'quarto_inline_output', 'console_test_py.qmd'));
		await editors.waitForActiveTab('console_test_py.qmd');
		await inlineQuarto.expectKernelStatusVisible();
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 15 });


		await test.step('Define a variable in the notebook session', async () => {
			// Define quux2345 by adding it to the existing code cell
			// and running it. This avoids typing into the console
			// input where the suggest widget can intercept Enter.
			await editors.selectTab('console_test_py.qmd');
			await inlineQuarto.gotoLine(11);
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('quux2345 = 99', { delay: 0 });
			await inlineQuarto.runCurrentCell();
			await sessions.expectAllSessionsToBeReady();

			// Unlike the R version, do NOT undo the edit here.
			// Python's LSP provides completions via static analysis
			// of the source code, so quux2345 must remain visible
			// in the file for the notebook LSP to offer it.
		});

		// Switch to the notebook console
		await sessions.select('console_test_py.qmd');
		await console.waitForReady('>>>');

		// Clear the console input and type the prefix.
		await console.clearInput();
		await keyboard.type('quux', { delay: 250 });

		// Trigger completions and verify we see quux2345 (from the
		// notebook session). If the console LSP is incorrectly
		// active, we would see quux1234 instead.
		const suggestWidget = page.locator('.suggest-widget.visible');
		await expect(async () => {
			await keyboard.press('Control+Space');
			await expect(suggestWidget).toBeVisible({ timeout: 5000 });
			await expect(suggestWidget.getByLabel(/quux2345/)).toBeVisible({ timeout: 5000 });
		}).toPass({ timeout: 30000 });
	});

	test('Python - Autocomplete in Quarto uses Quarto LSP after switching to console', {
		tag: [tags.QUARTO]
	}, async function ({ app, page, openFile, sessions }) {
		const { editors, inlineQuarto } = app.workbench;
		const keyboard = page.keyboard;
		const suggestionList = page.locator('.suggest-widget .monaco-list-row');

		// Start a Python console session
		const [pySession] = await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();

		// Open the simple Python qmd file - it defines x and df
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_py.qmd'));
		await editors.waitForActiveTab('simple_py.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell to start the Quarto kernel session and define df
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });

		// Re-focus the file in the editor after inline output
		await editors.selectTab('simple_py.qmd');

		// Select the Quarto console tab to make it the foreground
		await sessions.select('simple_py.qmd');

		// Now switch back to the Python console tab - this makes
		// the console session the foreground, which is the key
		// trigger for the bug
		await sessions.select(pySession.id);

		await test.step('Type in Quarto and verify completions use Quarto LSP', async () => {
			// Switch back to the Quarto file in the editor
			await editors.selectTab('simple_py.qmd');

			// Go to line 11 (df = pd.DataFrame(...)), press End to go
			// to end of line, Enter to create a new line inside the
			// code block, then type df. to trigger completions.
			// If the Quarto LSP is active, df is known and we should
			// see DataFrame attribute completions.
			// If the console LSP is wrongly active, df does not exist
			// in the console session, so no completions.
			await inlineQuarto.gotoLine(11);
			await keyboard.press('End');
			await keyboard.press('Enter');
			await keyboard.type('df.', { delay: 250 });

			// Explicitly trigger completions
			await expect(async () => {
				await keyboard.press('Control+Space');
				await expect(suggestionList.first()).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout: 30000 });

			// The toPass loop above already verifies that suggestion
			// items appeared. If the console LSP were wrongly active,
			// df would not exist and we'd get no completions. The
			// presence of suggestions confirms the Quarto LSP is
			// correctly providing them.
		});
	});

	test('R - Autocomplete works in Quarto without inline output', {
		tag: [tags.ARK, tags.QUARTO]
	}, async function ({ app, page, openFile, sessions, hotKeys, settings, r }) {
		const { editors, inlineQuarto } = app.workbench;
		const keyboard = page.keyboard;

		// Open the simple R rmd file
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
		await editors.waitForActiveTab('simple_r.rmd');

		// Go to line 11 (df <- data.frame(x, y)), press End to go
		// to end of line, Enter to create a new line inside the
		// code block, then type data.f to trigger completions.
		// The console LSP should handle the vdoc and provide
		// completions for base R functions like data.frame.
		await inlineQuarto.gotoLine(11);
		await keyboard.press('End');
		await keyboard.press('Enter');
		await keyboard.type('data.f', { delay: 250 });

		// The console LSP serves completions for the Quarto vdoc, so
		// typing data.f should offer base R's data.frame.
		const suggestWidget = page.locator('.suggest-widget');
		await expect(async () => {
			await keyboard.press('Control+Space');
			await expect(
				suggestWidget.getByRole('option', { name: /^data\.frame[,\s]/ })
			).toBeVisible({ timeout: 5000 });
		}).toPass({ timeout: 30000 });

	});
});
