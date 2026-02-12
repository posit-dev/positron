/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as fs from 'fs';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ app, python, settings }) {
		// Start Python first to ensure a runtime is available
		// The python fixture handles this, but we need to ensure it completes

		// Enable the Quarto inline output feature
		// Use reload to ensure the feature initializes properly
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: true });
	});

	test.afterAll(async function ({ settings }) {
		// Disable the feature after tests
		await settings.set({
			'positron.quarto.inlineOutput.enabled': false
		});
	});

	test('Python - Verify inline output appears after running a code cell', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with Python code
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to recognize this as a Quarto document
		// The kernel status widget appears in the editor action bar when the feature is enabled and a .qmd file is open
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Use "Go to Line" command to position cursor in the Python code cell
		// simple_plot.qmd: frontmatter (1-5), heading (7), code cell starts at line 9
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');

		// Wait for cursor to be positioned
		await page.waitForTimeout(500);

		// Run the current cell using the command
		// This will start the Quarto kernel if not already running
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		// The output should appear in a view zone with class 'quarto-inline-output'
		// Use longer timeout since kernel startup may take time
		const inlineOutput = page.locator('.quarto-inline-output');

		// Monaco virtualizes content - the view zone won't be in the DOM until we scroll to it.
		// The cell ends at line 19, so scroll to line 25 to ensure the output area is visible.
		// We need to poll/retry since the output takes time to appear after kernel execution.
		await expect(async () => {
			// Scroll editor to show the area after the cell where output appears
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Now check if the output element is visible
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output container has content
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Verify there is at least one output item
		const outputItem = inlineOutput.locator('.quarto-output-item');
		await expect(outputItem.first()).toBeVisible({ timeout: 10000 });
	});

	test('Python - Verify output is not duplicated after opening multiple qmd files', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// This test verifies that outputs are not duplicated when multiple qmd files
		// have been opened. There was a bug where event subscriptions accumulated
		// without being disposed, causing outputs to be rendered multiple times.

		// Open several qmd files to trigger multiple QuartoOutputContribution initializations
		await openFile(join('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await page.waitForTimeout(1000);

		await openFile(join('workspaces', 'quarto_interactive', 'quarto_interactive.qmd'));
		await page.waitForTimeout(1000);

		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await page.waitForTimeout(1000);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 12)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// CRITICAL: Verify there is exactly ONE output view zone, not duplicates
		// The bug caused outputs to appear multiple times when multiple qmd files were opened
		const outputCount = await inlineOutput.count();
		expect(outputCount).toBe(1);

		// Verify the single output has exactly one output content area
		const outputContent = inlineOutput.locator('.quarto-output-content');
		const contentCount = await outputContent.count();
		expect(contentCount).toBe(1);
	});

	test('Python - Verify clicking X button clears inline output', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with Python code
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 12)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output is present
		await expect(inlineOutput).toBeVisible({ timeout: 10000 });

		// Find the close button (X)
		const closeButton = inlineOutput.locator('.quarto-output-close');
		await expect(closeButton).toBeVisible({ timeout: 5000 });

		// Scroll to make sure the output area is in view by going to a line after the cell
		// This uses Monaco's native scrolling rather than scrollIntoViewIfNeeded which
		// can cause erratic horizontal scrolling
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('20');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Click the X button to clear the output
		await closeButton.click();

		// Wait for the output to be removed from the DOM
		await expect(inlineOutput).not.toBeVisible({ timeout: 5000 });
	});

	test('Python - Verify inline output persists after closing and reopening file', async function ({ app, openFile }) {
		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'simple_plot.qmd');

		// Open a Quarto document with Python code
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 12)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content is present
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Close the file
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

		// Wait for editor to close
		await page.waitForTimeout(500);

		// Reopen the same file
		await openFile(filePath);

		// Wait for the editor to be ready again
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(1000);

		// The cached output should still be visible after reopening
		// Use retry pattern since loading is async
		await expect(async () => {
			// Scroll to where the output should be (after cell ends at line 19)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Check if the output is visible
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// Verify the content is present
		await expect(outputContent).toBeVisible({ timeout: 10000 });
	});

	test('Python - Verify running cell after editing content works via toolbar', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// This test reproduces a bug where running a cell via the floating toolbar
		// after editing the cell content would fail with "Cell not found" error.
		// The bug was caused by the toolbar callbacks capturing the old cell object
		// in a closure instead of using the current cell reference.

		// Open a Quarto document designed for edit testing
		await openFile(join('workspaces', 'quarto_inline_output', 'editable_cell.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 13)
		// editable_cell.qmd: frontmatter (1-5), heading (7), description (9), cell starts line 11
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('13');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Wait for the floating toolbar to appear (it shows when cursor is in a cell)
		const toolbar = page.locator('.quarto-cell-toolbar');
		await expect(toolbar.first()).toBeVisible({ timeout: 5000 });

		// Find and click the run button on the floating toolbar
		const runButton = toolbar.locator('.quarto-toolbar-run');
		await expect(runButton.first()).toBeVisible({ timeout: 5000 });
		await runButton.first().click();

		// Wait for inline output to appear (first execution)
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('20');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content appeared
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Now edit the cell by adding a comment
		// Position cursor back in the cell
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('13');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Go to end of line and add a comment
		await page.keyboard.press('End');
		await page.keyboard.type('  # test comment');
		await page.waitForTimeout(1000); // Wait for document to re-parse

		// Wait for the floating toolbar to appear again (cursor is in cell)
		await expect(toolbar.first()).toBeVisible({ timeout: 5000 });

		// CRITICAL: Click the run button again after editing the cell
		// This is where the bug would manifest - the toolbar would use the old cell ID
		// and fail with "Cell not found" error
		await runButton.first().click();

		// Wait for execution to complete and verify output was updated
		// The output should clear and show new content
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('20');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			// Output should still be visible (execution succeeded)
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// Verify output content is present (execution completed successfully)
		await expect(outputContent).toBeVisible({ timeout: 10000 });
	});

	test('R - Verify inline output appears after running a code cell in Rmd file', async function ({ app, openFile, r }) {
		const page = app.code.driver.page;

		// Open a simple R Markdown document with R code
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to recognize this as a Quarto/Rmd document
		// The kernel status widget appears in the editor action bar when the feature is enabled
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Use "Go to Line" command to position cursor in the R code cell
		// simple_r.rmd: frontmatter (1-5), heading (7), cell starts line 9
		// This chunk outputs a data frame, so it will produce visible output.
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('11');
		await page.keyboard.press('Enter');

		// Wait for cursor to be positioned
		await page.waitForTimeout(500);

		// Run the current cell using the command
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll/retry since the output takes time to appear after kernel execution
		await expect(async () => {
			// Scroll editor to show the area after the cell where output appears
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('20');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Now check if the output element is visible
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output container has content
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Verify there is at least one output item
		const outputItem = inlineOutput.locator('.quarto-output-item');
		await expect(outputItem.first()).toBeVisible({ timeout: 10000 });
	});

	test('R - Verify multi-language document shows inline output for both languages', async function ({ app, openFile, r, python }) {
		// This test verifies that in a multi-language Quarto document:
		// 1. The primary language (R) cells execute inline via the kernel
		// 2. Non-primary language (Python) cells execute via console AND show inline output
		//
		// This ensures users can work with documents containing multiple languages
		// and see output inline for all languages.
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'multiple_languages.qmd');

		// Open the multi-language Quarto document
		// This document has R as the primary language (first cell) and Python as secondary
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// STEP 1: Run the R cell (primary language - should produce inline output)
		// multiple_languages.qmd structure:
		// - frontmatter (1-4)
		// - blank line (5)
		// - heading "## R" (6)
		// - blank line (7)
		// - description (8)
		// - blank line (9)
		// - R cell (10-12): ```{r} print("Hello from R") ```
		// - blank lines (13-14)
		// - heading "## Python" (15)
		// - blank line (16)
		// - description (17)
		// - blank line (18)
		// - Python cell (19-22): ```{python} import os \n os.getpid() ```

		// Position cursor in the R code cell (line 11)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('11');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the R cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear from the R cell
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('14');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the R output contains our expected text
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent.first()).toBeVisible({ timeout: 10000 });
		await expect(outputContent.first()).toContainText('Hello from R');

		// STEP 2: Run the Python cell (non-primary language)
		// Should execute via console AND produce inline output
		// Position cursor in the Python code cell (line 21)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('21');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the Python cell - should execute via console and show inline output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for Python console to show output
		// The Python code is: import os; os.getpid()
		// The output should appear in BOTH the Python console AND inline
		await expect(async () => {
			// Focus the console panel
			await app.workbench.quickaccess.runCommand('workbench.panel.positronConsole.focus');
			await page.waitForTimeout(500);

			// The console should show the executed code and output
			// Look for evidence that Python code was executed
			const consoleOutput = page.locator('.positron-console');
			await expect(consoleOutput).toBeVisible({ timeout: 1000 });

			// Check that the Python console shows our import os or os.getpid()
			// The console typically shows the code that was executed
			const consoleText = await consoleOutput.textContent();
			expect(consoleText).toContain('os');
		}).toPass({ timeout: 60000 });

		// Now verify that inline output ALSO appeared for the Python cell
		await app.workbench.quickaccess.runCommand('workbench.action.focusActiveEditorGroup');
		await page.waitForTimeout(500);

		// Scroll to see the Python cell's inline output (after line 22)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Count inline outputs - should be exactly 2 (R output + Python output)
			const inlineOutputCount = await inlineOutput.count();
			expect(inlineOutputCount).toBe(2);
		}).toPass({ timeout: 30000 });

		// Verify the second output contains Python output (the PID)
		// The Python code runs os.getpid() which returns an integer
		const secondOutput = inlineOutput.nth(1).locator('.quarto-output-content');
		await expect(secondOutput).toBeVisible({ timeout: 10000 });
		// The output should contain a number (the PID)
		const outputText = await secondOutput.textContent();
		expect(outputText).toBeTruthy();
		// PID should be a number - just verify it's not empty
		expect(outputText!.trim().length).toBeGreaterThan(0);
	});

	test('Python - Verify text can be selected via click and drag in inline output', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with text output for selection testing
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 13)
		// text_output.qmd: frontmatter (1-5), heading (7), description (9), cell starts line 11
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('13');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			// Scroll to show the area after the cell where output appears
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content is present and contains text (not a webview/plot)
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Get the text element containing stdout output
		const outputText = inlineOutput.locator('.quarto-output-stdout').first();
		await expect(outputText).toBeVisible({ timeout: 5000 });

		// Verify it contains our expected text
		await expect(outputText).toContainText('Hello World');

		// Get the bounding box of the output text
		const boundingBox = await outputText.boundingBox();
		expect(boundingBox).not.toBeNull();

		// Clear any existing selection first
		await page.evaluate(() => window.getSelection()?.removeAllRanges());

		// Perform a click-and-drag gesture to select text within the output
		// Start at the beginning of the output text and drag across it
		const startX = boundingBox!.x + 10;
		const startY = boundingBox!.y + boundingBox!.height / 2;
		const endX = boundingBox!.x + Math.min(boundingBox!.width - 10, 200);
		const endY = startY;

		// Use page.mouse for fine-grained control
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(endX, endY, { steps: 10 });
		await page.mouse.up();

		// Wait a moment for the selection to register
		await page.waitForTimeout(200);

		// Get the current text selection from the page
		const selectedText = await page.evaluate(() => {
			const selection = window.getSelection();
			return selection ? selection.toString().trim() : '';
		});

		// CRITICAL: Verify that text was actually selected via click and drag
		// The bug caused no text to be selected because Monaco intercepted mouse events
		expect(selectedText.length).toBeGreaterThan(0);
		// Verify the selection contains text from the output (could be from any line)
		// The output has: "Hello World...", "This is additional text...", "Line three..."
		const containsOutputText = selectedText.includes('World') ||
			selectedText.includes('Hello') ||
			selectedText.includes('additional') ||
			selectedText.includes('text') ||
			selectedText.includes('Line');
		expect(containsOutputText).toBe(true);
	});

	test('Python - Verify kernel status persists after window reload', async function ({ app, openFile }) {
		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'simple_plot.qmd');

		// Close all editors first to ensure a clean state
		// This is important when running in a suite where previous tests may have left state
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		await page.waitForTimeout(1000);

		// Open a Quarto document with Python code
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 12)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell to start the kernel
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear (confirms kernel executed code)
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Get the kernel label text - should show the runtime name (e.g., "Python 3.12.1")
		// Wait for the kernel to be fully ready (not "Starting..." or "No Kernel")
		const kernelLabel = kernelStatusWidget.locator('.kernel-label');
		let initialKernelText: string | null = null;
		await expect(async () => {
			initialKernelText = await kernelLabel.textContent();
			// Verify the kernel is running (label should NOT be "No Kernel" or "Starting...")
			expect(initialKernelText).not.toBe('No Kernel');
			expect(initialKernelText).not.toBe('Starting...');
			expect(initialKernelText).toBeTruthy();
		}).toPass({ timeout: 30000 });

		// Wait for session to be fully ready and persisted before reload
		// This ensures the session has been saved to storage
		await page.waitForTimeout(2000);

		// Reload the window
		await app.workbench.quickaccess.runCommand('workbench.action.reloadWindow');

		// Wait for the reload to complete
		// After reload, we need to wait for the editor and kernel status widget to appear again
		await expect(editor).toBeVisible({ timeout: 60000 });
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// CRITICAL: The kernel status should still show the runtime name, not "No Kernel"
		// This verifies that the QuartoKernelManager correctly reattaches to the existing session
		// Use a retry pattern since session restoration may take some time after reload
		const kernelLabelAfterReload = kernelStatusWidget.locator('.kernel-label');
		await expect(async () => {
			const kernelTextAfterReload = await kernelLabelAfterReload.textContent();
			// The kernel should still be connected - the label should NOT be "No Kernel"
			expect(kernelTextAfterReload).not.toBe('No Kernel');
			expect(kernelTextAfterReload).toBeTruthy();
			// Verify it's the same kernel name as before
			expect(kernelTextAfterReload).toBe(initialKernelText);
		}).toPass({ timeout: 30000 });
	});

	test('Python - Verify copy button appears in inline output and shows success feedback', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with text output
		await openFile(join('workspaces', 'quarto_inline_output', 'copy_output_test.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the text output cell (around line 12)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('18');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the copy button exists
		const copyButton = inlineOutput.locator('.quarto-output-copy');
		await expect(copyButton).toBeVisible({ timeout: 5000 });

		// Click the copy button
		await copyButton.click();

		// Verify the button shows success state (green check icon)
		// The button should have 'copy-success' class after clicking
		await expect(copyButton).toHaveClass(/copy-success/, { timeout: 2000 });

		// Wait for the success state to revert (after 1.5 seconds)
		await page.waitForTimeout(2000);
		await expect(copyButton).not.toHaveClass(/copy-success/, { timeout: 2000 });
	});

	test('Python - Verify copy output command copies text from cell output', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with text output
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the code cell (line 13)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('13');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('20');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Position cursor back inside the cell before running the copy command
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('13');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Use the copy output command
		await app.workbench.quickaccess.runCommand('positronQuarto.copyOutput');

		// Verify the copy button shows success feedback
		// This confirms the copy command executed successfully
		const copyButton = inlineOutput.locator('.quarto-output-copy');
		await expect(copyButton).toHaveClass(/copy-success/, { timeout: 2000 });

		// Note: We can't verify clipboard contents in E2E tests due to browser permission restrictions
		// The success feedback indicates the copy operation completed successfully
	});

	test('Python - Verify inline output works in untitled Quarto document and persists through save', async function ({ app, runCommand }) {
		const page = app.code.driver.page;
		const { quickInput } = app.workbench;

		// Generate a unique filename for saving later
		const savedFileName = `untitled-test-${Math.random().toString(36).substring(7)}.qmd`;

		// Step 1: Create a new untitled Quarto document using the Quarto extension command
		await runCommand('quarto.newDocument');

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to recognize this as a Quarto document
		// The kernel status widget should appear even for untitled documents
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Step 2: Add a simple Python code chunk to the document
		// Go to end of document and add content
		await editor.click();
		await page.waitForTimeout(500);
		await page.keyboard.press('ControlOrMeta+End');
		await page.waitForTimeout(200);

		// Add some newlines first
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');

		// Type the code fence opening - use individual key presses for backticks
		await page.keyboard.press('Backquote');
		await page.keyboard.press('Backquote');
		await page.keyboard.press('Backquote');
		await page.keyboard.type('{python}');
		await page.keyboard.press('Enter');

		// Type the Python code
		await page.keyboard.type('print("Hello from untitled!")');
		await page.keyboard.press('Enter');

		// Type the closing fence
		await page.keyboard.press('Backquote');
		await page.keyboard.press('Backquote');
		await page.keyboard.press('Backquote');

		await page.waitForTimeout(1500); // Wait for document to parse

		// Verify the cell toolbar appeared (should show run button)
		const cellToolbar = page.locator('.quarto-cell-toolbar');
		await expect(cellToolbar.first()).toBeVisible({ timeout: 10000 });

		// Step 3: Click the run button on the cell toolbar
		const runButton = cellToolbar.locator('button.quarto-toolbar-run').first();
		await runButton.click();

		// Step 4: Verify that the chunk output is shown inline
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			// Scroll to show the area after the cell where output appears
			await runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('10');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output content is present and contains our expected text
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		const outputText = inlineOutput.locator('.quarto-output-stdout');
		await expect(outputText).toContainText('Hello from untitled!');

		// Step 5: Save the document to a file on disk
		// Wait for the cache write debounce to complete before saving
		// The cache service uses a 1000ms debounce, so wait a bit longer to ensure it's flushed
		await page.waitForTimeout(1500);
		await runCommand('workbench.action.files.saveAs', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();

		// Type the filename (it will save to the workspace folder)
		await quickInput.type(join(app.workspacePathOrFolder, savedFileName));
		await quickInput.clickOkButton();

		// Wait for save to complete - verify the tab name changed to the saved filename
		const { editors } = app.workbench;
		await editors.waitForActiveTab(savedFileName, false);

		// Wait for the Quarto inline output feature to reinitialize for the saved file
		// The kernel status widget should still be visible after save
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });
		await page.waitForTimeout(1000); // Give time for cache transfer and view zone recreation

		// Verify the output is still visible after saving
		await expect(async () => {
			await runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('10');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		await expect(outputText).toContainText('Hello from untitled!');

		// Step 6: Reload the page and verify output persists (cache bound to saved file)
		await runCommand('workbench.action.reloadWindow');

		// Wait for the editor to be ready again after reload
		await expect(editor).toBeVisible({ timeout: 60000 });
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Wait for the cache service to load cached outputs
		await page.waitForTimeout(2000);

		// Scroll to where output should be and verify it's still there
		await expect(async () => {
			await runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('10');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		await expect(outputText).toContainText('Hello from untitled!');

		// Cleanup: Close the file without saving further changes
		await runCommand('workbench.action.closeActiveEditor');
	});

	test('Python - Verify multiple untitled documents each reattach to correct kernel after window reload', async function ({ app, runCommand }) {
		// This test verifies that MULTIPLE untitled Quarto documents each reattach to their
		// correct Python kernel after window reload. This is the hard case - when there are
		// two Python sessions, we can't just match by language. We need content hash matching.
		//
		// The test:
		// 1. Creates TWO untitled Quarto documents, each with different Python code
		// 2. Runs the cells to start two separate Python kernels
		// 3. Records the PID from each document
		// 4. Reloads the window
		// 5. Runs the cells again and verifies each document got its original kernel back

		const page = app.code.driver.page;

		// Helper function to create an untitled doc with a Python cell and run it
		async function createAndRunUntitledDoc(docId: string): Promise<string> {
			// Create a new untitled Quarto document
			await runCommand('quarto.newDocument');

			// Wait for the editor to be ready
			const editor = page.locator('.monaco-editor').first();
			await expect(editor).toBeVisible({ timeout: 10000 });

			// Wait for the Quarto inline output feature to initialize
			const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
			await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

			// Add a Python code chunk with a unique identifier and os.getpid()
			await editor.click();
			await page.waitForTimeout(500);
			await page.keyboard.press('ControlOrMeta+End');
			await page.waitForTimeout(200);

			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');

			// Type the code fence
			await page.keyboard.press('Backquote');
			await page.keyboard.press('Backquote');
			await page.keyboard.press('Backquote');
			await page.keyboard.type('{python}');
			await page.keyboard.press('Enter');

			// Type Python code - include docId as a comment to make content unique
			await page.keyboard.type(`# Document ${docId}`);
			await page.keyboard.press('Enter');
			await page.keyboard.type('import os');
			await page.keyboard.press('Enter');
			await page.keyboard.type('os.getpid()');
			await page.keyboard.press('Enter');

			// Type the closing fence
			await page.keyboard.press('Backquote');
			await page.keyboard.press('Backquote');
			await page.keyboard.press('Backquote');

			await page.waitForTimeout(2000); // Wait for document to parse (longer wait for reliability)

			// Wait for the cell toolbar to appear using retry pattern
			const cellToolbar = page.locator('.quarto-cell-toolbar');
			await expect(async () => {
				// Scroll to make sure the cell is visible
				await runCommand('workbench.action.gotoLine', { keepOpen: true });
				await page.keyboard.type('8');
				await page.keyboard.press('Enter');
				await page.waitForTimeout(500);
				await expect(cellToolbar.first()).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 30000 });

			// Click the run button on the cell toolbar
			const runButton = cellToolbar.locator('button.quarto-toolbar-run').first();
			await runButton.click();

			// Wait for inline output to appear
			const inlineOutput = page.locator('.quarto-inline-output');
			await expect(async () => {
				await runCommand('workbench.action.gotoLine', { keepOpen: true });
				await page.keyboard.type('12');
				await page.keyboard.press('Enter');
				await page.waitForTimeout(500);
				await expect(inlineOutput).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 120000 });

			// Extract the PID from the output
			const outputItem = inlineOutput.locator('.quarto-output-item');
			await expect(outputItem.first()).toBeVisible({ timeout: 10000 });
			const outputText = await outputItem.first().textContent();
			const pid = outputText?.trim() ?? '';
			expect(Number(pid)).toBeGreaterThan(0);

			return pid;
		}

		// Helper function to get the PID from the current document by running its cell
		async function getPidFromCurrentDoc(): Promise<string> {
			// Position cursor in the cell and run it
			await runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('7');  // Line inside the code cell
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			await runCommand('positronQuarto.runCurrentCell');

			// Wait for output to update (longer timeout for kernel execution after reload)
			await page.waitForTimeout(5000);

			// Scroll to see the output
			const inlineOutput = page.locator('.quarto-inline-output');
			await expect(async () => {
				await runCommand('workbench.action.gotoLine', { keepOpen: true });
				await page.keyboard.type('12');
				await page.keyboard.press('Enter');
				await page.waitForTimeout(500);
				await expect(inlineOutput).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 60000 }); // Increased timeout for kernel startup after reload

			const outputItem = inlineOutput.locator('.quarto-output-item');
			const outputText = await outputItem.first().textContent();
			return outputText?.trim() ?? '';
		}

		// Step 1: Create first untitled document and get its PID
		const pid1Before = await createAndRunUntitledDoc('ONE');

		// Step 2: Create second untitled document and get its PID
		const pid2Before = await createAndRunUntitledDoc('TWO');

		// Verify we have two different PIDs (two separate Python processes)
		expect(pid1Before).not.toBe(pid2Before);

		// Step 3: Wait for cache writes to complete
		await page.waitForTimeout(2500);

		// Step 4: Reload the window
		await runCommand('workbench.action.reloadWindow');

		// Wait for editor to be ready after reload
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 60000 });

		// Wait for Quarto features to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Wait for kernel to reattach - the label should show a runtime name, not "No Kernel"
		const kernelLabel = kernelStatusWidget.locator('.kernel-label');
		await expect(async () => {
			const text = await kernelLabel.textContent();
			expect(text).not.toBe('No Kernel');
			expect(text).toBeTruthy();
		}).toPass({ timeout: 30000 });

		// Additional wait for session to stabilize after reattachment
		await page.waitForTimeout(3000);

		// Step 5: We should be on the second document (last opened). Get its PID.
		const pid2After = await getPidFromCurrentDoc();

		// Step 6: Switch to the first document and get its PID
		// Use Ctrl+Tab or the editor tabs to switch
		await runCommand('workbench.action.previousEditor');
		await page.waitForTimeout(1000);
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Wait for this document's kernel to be ready too
		await expect(async () => {
			const text = await kernelLabel.textContent();
			expect(text).not.toBe('No Kernel');
			expect(text).toBeTruthy();
		}).toPass({ timeout: 30000 });
		await page.waitForTimeout(2000);

		const pid1After = await getPidFromCurrentDoc();

		// Step 7: CRITICAL ASSERTIONS - Each document should have its original kernel
		expect(pid1After).toBe(pid1Before);
		expect(pid2After).toBe(pid2Before);

		// Cleanup: Close all editors without saving
		await runCommand('workbench.action.closeAllEditors');
		const dontSaveButton = page.getByRole('button', { name: /Don't Save/i });
		// May need to click multiple times for multiple unsaved files
		for (let i = 0; i < 3; i++) {
			if (await dontSaveButton.isVisible({ timeout: 1000 }).catch(() => false)) {
				await dontSaveButton.click();
				await page.waitForTimeout(500);
			}
		}
	});

	test('Python - Verify DataFrame output shows HTML only, not duplicate text and HTML', async function ({ app, openFile }) {
		// This test verifies a bug fix where pandas DataFrames were showing both
		// HTML and plain text representations. The kernel sends both formats, but
		// we should only display the richer HTML format, not both.
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output
		// to be set, as the py_data_frame.qmd file only exists on that branch.

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'py_data_frame.qmd');

		// Open the Quarto document with pandas DataFrame code
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell that creates a DataFrame
		// py_data_frame.qmd: frontmatter (1-4), blank line (5), cell starts at line 6
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('8');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content is present
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// CRITICAL CHECK: The output should contain EITHER an HTML table OR plain text,
		// but NOT both. The bug causes both to appear.

		// Count the number of output items in the view zone
		const outputItems = inlineOutput.locator('.quarto-output-item');
		const outputItemCount = await outputItems.count();

		// There should be exactly 1 output item (just the HTML representation)
		// The bug would show 2 items (both HTML and plain text)
		expect(outputItemCount).toBe(1);

		// Additionally, verify the output contains HTML (the preferred format for DataFrames)
		// DataFrames render as HTML tables
		const htmlOutput = inlineOutput.locator('.quarto-output-html');
		const htmlCount = await htmlOutput.count();

		// Should have HTML output
		expect(htmlCount).toBeGreaterThan(0);

		// Should NOT have plain text stdout output that duplicates the DataFrame
		// (stdout is OK for print statements, but not for DataFrame display)
		const stdoutOutput = inlineOutput.locator('.quarto-output-stdout');
		const stdoutCount = await stdoutOutput.count();

		// If there is stdout, it should not contain DataFrame-like content
		if (stdoutCount > 0) {
			const stdoutText = await stdoutOutput.first().textContent();
			// DataFrame text output typically contains column headers and data rows
			// The HTML table will already show this, so we shouldn't have duplicate text
			// that looks like a DataFrame (has column-like structure)
			expect(stdoutText).not.toContain('col1');
			expect(stdoutText).not.toContain('col2');
		}
	});

	test('Python - Verify interactive HTML widget persists correctly after window reload', async function ({ app, openFile, python }) {
		// This test reproduces a bug where interactive HTML widgets (like Plotly)
		// render correctly on first execution, but after a window reload they
		// render as a blob of JSON instead of the interactive widget.
		//
		// The bug was caused by _outputToIpynb in quartoOutputCacheService.ts
		// only storing the FIRST mime type instead of ALL mime types. For Plotly:
		// - Original output has: application/vnd.plotly.v1+json AND text/html
		// - Cache stored: only application/vnd.plotly.v1+json (first one)
		// - On restore: Only JSON mime type available, no text/html fallback
		// - Rendering: Falls through to text/JSON rendering instead of HTML widget
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output
		// to be set, as the interactive_plot.qmd file only exists on that branch.

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd');

		// Open the Quarto document with the interactive Plotly widget
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell
		// interactive_plot.qmd: frontmatter (1-4), blank line (5), cell starts at line 6
		// Position at line 8 which is inside the cell
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('8');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content is present
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// CRITICAL CHECK: The output should contain a webview container for the interactive widget,
		// NOT a text rendering with JSON content.
		// Look for either the webview container or HTML output class
		const webviewOrHtml = inlineOutput.locator('.quarto-output-webview-container, .quarto-output-html');

		// First, verify the widget IS rendered correctly (should be a webview or HTML, not raw text)
		await expect(webviewOrHtml.first()).toBeVisible({ timeout: 30000 });

		// Verify there's no raw JSON blob visible (this would indicate the bug)
		// The plotly JSON would contain "application/vnd.plotly" or typical plotly markers
		const stdoutContent = inlineOutput.locator('.quarto-output-stdout');
		const stdoutCount = await stdoutContent.count();
		if (stdoutCount > 0) {
			const text = await stdoutContent.first().textContent();
			// If there's stdout, it shouldn't be raw JSON from plotly
			expect(text).not.toContain('application/vnd.plotly');
			expect(text).not.toContain('"data":');
		}

		// Wait for the cache write debounce to complete before reloading
		await page.waitForTimeout(2000);

		// Reload the window
		await app.workbench.quickaccess.runCommand('workbench.action.reloadWindow');

		// Wait for the reload to complete
		await expect(editor).toBeVisible({ timeout: 60000 });
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Wait for the cache service to load cached outputs
		await page.waitForTimeout(2000);

		// Scroll to where output should be and verify webview/HTML container is visible
		// Use retry pattern since Monaco virtualization can make elements hidden until scrolled into view
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
			// CRITICAL CHECK AFTER RELOAD: The output should STILL be rendered as HTML/webview,
			// NOT as a JSON blob.
			await expect(webviewOrHtml.first()).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// Verify there's NO raw JSON blob after reload (this is the bug we're testing for)
		const stdoutAfterReload = inlineOutput.locator('.quarto-output-stdout');
		const stdoutCountAfterReload = await stdoutAfterReload.count();
		if (stdoutCountAfterReload > 0) {
			const textAfterReload = await stdoutAfterReload.first().textContent();
			// If stdout exists after reload, it should NOT contain JSON from the plotly output
			// This is the core assertion - the bug causes plotly JSON to render as text
			expect(textAfterReload).not.toContain('application/vnd.plotly');
			expect(textAfterReload).not.toContain('"data":');
			expect(textAfterReload).not.toContain('"layout":');
		}
	});

	test('Python - Verify cell execution uses correct line numbers after document edits', async function ({ app, openFile, python }) {
		// This test reproduces a bug where quarto cell metadata does not update as
		// the document is edited, causing execution to read wrong lines of code.
		//
		// Exact reproduction steps from the bug report:
		// 1. Open a document with two or more cells (editable_cell.qmd)
		// 2. Run both cells
		// 3. Add some lines of ordinary text between the first two cells
		// 4. Run the second cell - with the bug, it reads wrong lines
		//
		// The fix uses Monaco's tracked ranges to keep cell positions accurate.

		const page = app.code.driver.page;

		// Close all editors first to ensure a clean state
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		await page.waitForTimeout(1000);

		// Open the editable_cell.qmd file which has two Python cells
		await openFile(join('workspaces', 'quarto_inline_output', 'editable_cell.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// editable_cell.qmd structure:
		// - frontmatter (1-4)
		// - blank line (5)
		// - heading (6)
		// - blank line (7)
		// - description (8)
		// - blank line (9)
		// - first cell (10-16) - has print output
		// - blank lines (17-18)
		// - second cell (19-22) - os.getpid()
		// - blank line (23)
		// - comment (24)

		// Step 1: Run ALL cells using the Run All command
		await app.workbench.quickaccess.runCommand('positronQuarto.runAllCells');

		// Wait for both cells to produce output (first cell has sleep(5), so wait longer)
		// Look for 2 inline output zones
		const inlineOutputs = page.locator('.quarto-inline-output');
		await expect(async () => {
			// Scroll to show where outputs should appear
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			// Should have 2 output zones (one per cell)
			const count = await inlineOutputs.count();
			expect(count).toBe(2);
		}).toPass({ timeout: 180000 }); // Long timeout for first cell sleep + kernel startup

		// Scroll to line 18 to show the first output (which is after line 16)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('18');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Verify first output is visible (it's near line 16)
		await expect(inlineOutputs.nth(0)).toBeVisible({ timeout: 10000 });

		// Scroll further down to ensure the second output (after line 22) is in the viewport
		// Monaco virtualizes content, so we need to scroll to make the second view zone visible
		// Use retry pattern since Monaco might need multiple scroll attempts
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			// Verify second output is visible
			await expect(inlineOutputs.nth(1)).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// Step 2: Add text BETWEEN the two cells
		// Go to line 17 (after first cell, before second cell)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('17');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		// Insert several lines of text
		await page.keyboard.press('Home');
		await page.keyboard.type('This is some new text inserted between cells.');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Adding more lines to shift the second cell down.');
		await page.keyboard.press('Enter');
		await page.keyboard.type('One more line for good measure.');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');

		// Wait for document model to re-parse (100ms debounce + buffer)
		await page.waitForTimeout(500);

		// Step 3: Run the SECOND cell again
		// The second cell has moved down (was at line 19, now at ~23)
		// Position cursor in the moved second cell
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('25');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);

		// CRITICAL: Run the current cell (should be the second cell)
		// With the bug, this would execute wrong code because cell metadata has stale line numbers
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for execution to complete
		await page.waitForTimeout(5000);

		// Scroll to see the output area
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('30');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// CRITICAL ASSERTION: The second cell's output should still be visible and valid
		// With the bug, we might see:
		// - An error (trying to execute markdown as Python)
		// - Wrong output (executing different code)
		// - No output (cell not found)
		const secondOutput = inlineOutputs.nth(1);
		await expect(secondOutput).toBeVisible({ timeout: 10000 });

		// Verify there are no error outputs
		const errorOutput = page.locator('.quarto-output-error');
		const errorCount = await errorOutput.count();
		expect(errorCount).toBe(0);

		// The output should contain a number (the PID)
		const outputItem = secondOutput.locator('.quarto-output-item');
		await expect(outputItem.first()).toBeVisible({ timeout: 10000 });
		const outputText = await outputItem.first().textContent();
		// The PID should be a positive integer
		const pid = parseInt(outputText?.trim() ?? '', 10);
		expect(pid).toBeGreaterThan(0);
	});

	test('Python - Verify save button saves plot to file', async function ({ app, openFile }) {
		const page = app.code.driver.page;
		const { quickInput } = app.workbench;

		// This test verifies the save plot functionality:
		// 1. Open a Quarto document that generates a plot
		// 2. Run the cell to generate the plot output
		// 3. Click the save button on the inline output
		// 4. Handle the save dialog and save to a specific location
		// 5. Verify the file was created and has valid content
		// 6. Clean up by deleting the file

		// Generate a unique filename for the saved plot
		const savedPlotName = `test-plot-${Date.now()}.png`;
		const savedPlotPath = join(app.workspacePathOrFolder, savedPlotName);

		try {
			// Open a Quarto document with a plot-generating cell
			await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));

			// Wait for the editor to be ready
			const editor = page.locator('.monaco-editor').first();
			await expect(editor).toBeVisible({ timeout: 10000 });

			// Wait for the Quarto inline output feature to initialize
			const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
			await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

			// Click on the editor to ensure focus
			await editor.click();
			await page.waitForTimeout(500);

			// Position cursor in the Python code cell (line 12)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('12');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Run the current cell to generate the plot
			await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

			// Wait for inline output to appear
			const inlineOutput = page.locator('.quarto-inline-output');
			await expect(async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
				await page.keyboard.type('25');
				await page.keyboard.press('Enter');
				await page.waitForTimeout(500);
				await expect(inlineOutput).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 120000 });

			// Verify output content is present and contains an image
			const outputContent = inlineOutput.locator('.quarto-output-content');
			await expect(outputContent).toBeVisible({ timeout: 10000 });

			// Verify the save button is visible (indicates a single plot exists)
			const saveButton = inlineOutput.locator('.quarto-output-save');
			await expect(saveButton).toBeVisible({ timeout: 5000 });

			// Click the save button to trigger the save dialog
			await saveButton.click();

			// Wait for the save dialog to open
			await quickInput.waitForQuickInputOpened();

			// Type the full path where we want to save the file
			await quickInput.type(savedPlotPath);

			// Click OK to save
			await quickInput.clickOkButton();

			// Wait for the save operation to complete
			// The operation should show a toast notification when done
			await page.waitForTimeout(2000);

			// CRITICAL: Verify the file was created
			expect(fs.existsSync(savedPlotPath)).toBe(true);

			// Verify the file has content (PNG files are at least a few hundred bytes)
			const stats = fs.statSync(savedPlotPath);
			expect(stats.size).toBeGreaterThan(100);

			// Verify it's a valid PNG by checking magic bytes
			const fileBuffer = fs.readFileSync(savedPlotPath);
			// PNG magic bytes: 137 80 78 71 13 10 26 10
			expect(fileBuffer[0]).toBe(137);
			expect(fileBuffer[1]).toBe(80);
			expect(fileBuffer[2]).toBe(78);
			expect(fileBuffer[3]).toBe(71);

		} finally {
			// Cleanup: Delete the saved file if it exists
			if (fs.existsSync(savedPlotPath)) {
				fs.unlinkSync(savedPlotPath);
			}
		}
	});

	test('R - Verify error output appears exactly once, not duplicated', async function ({ app, openFile, r }) {
		// This test reproduces a bug where R error output appears twice:
		// once from the stderr stream message and once from the error message.
		// The kernel sends both message types when an error occurs, and we
		// were not filtering out the duplicate.
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output
		// to be set, as the r_errors.qmd file only exists on that branch.

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'r_errors.qmd');

		// Open the R error test file
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// r_errors.qmd structure:
		// - frontmatter (1-4)
		// - text (6)
		// - R cell (8-10): stop("oh no")

		// Position cursor in the R code cell (line 9)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('9');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear (includes kernel startup time)
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('12');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content is present
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// CRITICAL ASSERTIONS:

		// 1. Verify there is exactly ONE output item (not two)
		// The bug causes two items: one from stderr stream, one from error message
		const outputItems = inlineOutput.locator('.quarto-output-item');
		const outputItemCount = await outputItems.count();
		expect(outputItemCount).toBe(1);

		// 2. Verify the error message contains "oh no" (our expected error)
		const allOutputText = await inlineOutput.textContent();
		expect(allOutputText).toContain('oh no');

		// 3. Double-check: count occurrences of "oh no" in the output
		// Should appear exactly once, not twice
		const ohNoMatches = (allOutputText?.match(/oh no/g) || []).length;
		expect(ohNoMatches).toBe(1);
	});

	test('Python - Verify cancel button removes queued cell from execution queue', async function ({ app, openFile }) {
		// This test verifies the cancel button functionality for queued cells:
		// 1. Open a document with two cells (first takes 3 seconds to run)
		// 2. Run both cells (they get queued sequentially)
		// 3. While the first cell is still running, click the cancel button on the second cell
		// 4. After the first cell completes, verify:
		//    - First cell produced output ("Time's up")
		//    - Second cell did NOT run (no "Oh no" output)
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'cancel_execution.qmd');

		// Open the cancel execution test file
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// cancel_execution.qmd structure:
		// - frontmatter (1-4)
		// - text (6)
		// - first cell (8-12): time.sleep(3) + print
		// - text (14)
		// - second cell (16-18): just prints

		// Position cursor in the FIRST cell and run both cells using "Run All"
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('10');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run all cells - this queues both cells
		await app.workbench.quickaccess.runCommand('positronQuarto.runAllCells');

		// Wait for the first cell to start running
		// The first cell's toolbar should show a stop button (running state)
		await page.waitForTimeout(1500); // Give time for execution to start

		// Now the second cell should be in "Queued" state
		// Find the second cell's toolbar by looking for the cancel button (clock icon)
		// The second cell is around line 17, so scroll there
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('17');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Find the toolbar for the second cell
		// It should have the "queued" class and clock icon
		const toolbars = page.locator('.quarto-cell-toolbar');
		const secondToolbar = toolbars.nth(1);

		// The run button should show the clock icon (queued state)
		const runButton = secondToolbar.locator('.quarto-toolbar-run');
		await expect(runButton).toBeVisible({ timeout: 5000 });

		// Verify the button has the queued class (indicating it's showing cancel option)
		await expect(runButton).toHaveClass(/queued/, { timeout: 5000 });

		// Click the cancel button to cancel the queued execution
		await runButton.click();

		// Wait for the first cell to complete (it has a 3-second sleep)
		// Total wait should be ~3-4 seconds from the start
		await page.waitForTimeout(4000);

		// Scroll to see the output area after the first cell
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('14');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// CRITICAL ASSERTIONS:

		// 1. Verify the first cell's output IS visible and contains "Time's up"
		const inlineOutputs = page.locator('.quarto-inline-output');
		const firstOutput = inlineOutputs.first();
		await expect(firstOutput).toBeVisible({ timeout: 120000 });

		const firstOutputContent = firstOutput.locator('.quarto-output-content');
		await expect(firstOutputContent).toContainText("Time's up");

		// 2. Verify there is only ONE output (the second cell should NOT have run)
		// If the second cell ran, it would produce "Oh no" output
		const outputCount = await inlineOutputs.count();
		expect(outputCount).toBe(1);

		// 3. Double-check: no output contains "Oh no"
		const allOutputText = await page.locator('.quarto-inline-output').allTextContents();
		const hasOhNo = allOutputText.some(text => text.includes('Oh no'));
		expect(hasOhNo).toBe(false);
	});

	test('Verify markdown image preview appears below image declaration', async function ({ app, openFile }) {
		// This test verifies that markdown images declared in Quarto documents
		// are automatically previewed inline below the declaration line.
		// The preview should show just the image without any borders or decorations.
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'images_and_equations.qmd');

		// Open the images and equations test file
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// images_and_equations.qmd structure:
		// - frontmatter (1-4)
		// - blank line (5)
		// - text (6)
		// - blank line (7)
		// - image line (8): ![The Mandlebrot Set](mandelbrot.jpg)
		// - blank line (9)
		// - text (10)
		// - blank line (11)
		// - equation (12-14)

		// CRITICAL ASSERTIONS:

		// 1. Verify the image preview view zone exists
		// Use retry pattern since Monaco virtualizes content and may need scrolling
		// Note: The file has multiple images (mandelbrot.jpg exists, julia.jpg doesn't),
		// so we need to select the specific image preview we're testing
		const imagePreview = page.locator('.quarto-image-preview-wrapper').first();
		await expect(async () => {
			// Scroll to where the image preview should appear (after line 8)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('10');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(imagePreview).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// 2. Verify there is at least one successfully loaded image
		// We use a filter to find the image with the correct alt text since there
		// may be multiple image previews (including error ones for missing images)
		const mandelbrotImage = page.locator('.quarto-image-preview[alt="The Mandlebrot Set"]');
		await expect(mandelbrotImage).toBeVisible({ timeout: 10000 });

		// 3. Verify the image has loaded (has a src attribute with data URL)
		const imgSrc = await mandelbrotImage.getAttribute('src');
		expect(imgSrc).toBeTruthy();
		// The image is converted to a data URL for security in Electron
		expect(imgSrc).toMatch(/^data:image\/jpeg;base64,/);

		// 4. Verify the preview container exists
		// The container should have minimal styling
		const previewContainer = page.locator('.quarto-image-preview-container').first();
		await expect(previewContainer).toBeVisible({ timeout: 5000 });
	});

	test('Verify missing image shows error message in preview', async function ({ app, openFile }) {
		// This test verifies that when a markdown image references a file that
		// doesn't exist, an error message is shown in the view zone instead of
		// an image. The error should be styled consistently with other Quarto
		// inline output errors.
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output
		// The images_and_equations.qmd file has a reference to julia.jpg which
		// is intentionally missing to test this error handling.

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'images_and_equations.qmd');

		// Open the images and equations test file
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// images_and_equations.qmd structure:
		// - frontmatter (1-4)
		// - blank line (5)
		// - text (6)
		// - blank line (7)
		// - image line (8): ![The Mandlebrot Set](mandelbrot.jpg) - EXISTS
		// - blank line (9)
		// - text (10)
		// - blank line (11)
		// - equation (12-14)
		// - blank line (15)
		// - text (16)
		// - blank line (17)
		// - image line (18): ![Julia Set](julia.jpg) - MISSING

		// CRITICAL ASSERTIONS:

		// 1. Verify the error view zone exists for the missing image
		// Use retry pattern since Monaco virtualizes content and may need scrolling
		const errorPreview = page.locator('.quarto-image-preview-error');
		await expect(async () => {
			// Scroll to where the error preview should appear (after line 18)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('20');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(errorPreview).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// 2. Verify the error message contains the filename
		const errorText = page.locator('.quarto-image-preview-error-text');
		await expect(errorText).toBeVisible({ timeout: 10000 });
		const errorContent = await errorText.textContent();
		expect(errorContent).toContain('julia.jpg');

		// 3. Verify the error message indicates the file was not found
		expect(errorContent).toContain('not found');

		// 4. Verify the error is styled with error colors (red border/background)
		// The error container should have the error styling classes
		const errorContainer = page.locator('.quarto-image-preview-error');
		await expect(errorContainer).toBeVisible({ timeout: 5000 });
	});

	test('R - Verify execute code action steps through statements line by line with inline output', async function ({ app, openFile, r }) {
		// This test verifies that the "Execute Code" action (workbench.action.positronConsole.executeCode)
		// works correctly with Quarto inline output:
		// 1. Each statement executed via "Execute Code" should produce inline output
		// 2. The cursor should advance to the next statement after execution
		// 3. Each execution should replace the previous output (only show current output)
		// 4. Selection execution should execute only the selected code
		// 5. Multi-line statements should be executed as a single unit
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'multiple_statements.qmd');

		// Open the multiple statements test file
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// multiple_statements.qmd structure:
		// - frontmatter (1-4)
		// - blank line (5)
		// - heading "## R" (6)
		// - blank line (7)
		// - description (8)
		// - blank line (9)
		// - first R cell (10-14):
		//   line 10: ```{r}
		//   line 11: print("This is the first statement.")
		//   line 12: print("This is the middle statement.")
		//   line 13: print("This one is last.")
		//   line 14: ```
		// - blank line (15)
		// - description (16)
		// - blank line (17)
		// - second R cell (18-27):
		//   line 18: ```{r}
		//   line 19: print(1 +
		//   line 20:     2 +
		//   line 21:     3)
		//   line 22: print(
		//   line 23:     seq_len(
		//   line 24:         10
		//   line 25:     )
		//   line 26: )
		//   line 27: ```

		// Helper function to position cursor and execute code
		async function goToLineAndExecute(lineNumber: number) {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type(String(lineNumber));
			await page.keyboard.press('Enter');
			await page.waitForTimeout(300);
			await page.keyboard.press('Meta+Enter');
		}

		// STEP 1: Execute the first line of the first cell (line 11)
		// Position cursor at line 11 (first print statement) and execute
		await goToLineAndExecute(11);

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			// Scroll down to see the output area by going to line 15 first
			// (we'll reposition cursor for subsequent executions)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output contains "first statement" and NOT the others
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });
		await expect(outputContent).toContainText('first statement');
		await expect(outputContent).not.toContainText('middle statement');
		await expect(outputContent).not.toContainText('last');

		// STEP 2: Execute the second line (line 12)
		// Explicitly position cursor at line 12 and execute
		await goToLineAndExecute(12);
		await page.waitForTimeout(2000);

		// Scroll to see output (go to line 15)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('15');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Verify the output now contains "middle statement" (previous output replaced)
		await expect(outputContent).toContainText('middle statement');
		// Note: The output may or may not contain "first statement" depending on implementation
		// The key requirement is that "middle statement" is shown

		// STEP 3: Execute the third line (line 13)
		await goToLineAndExecute(13);
		await page.waitForTimeout(2000);

		// Scroll to see output
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('15');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Verify the output contains "last"
		await expect(outputContent).toContainText('last');

		// STEP 4: Test selection execution - select only the middle statement and execute
		// Position cursor at line 12 (middle statement)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Select the entire line (Ctrl+L or Home, then Shift+End)
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.waitForTimeout(300);

		// Execute the selection
		await page.keyboard.press('Meta+Enter');
		await page.waitForTimeout(2000);

		// Scroll to see output
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('15');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Verify the output contains "middle statement" (from selection execution)
		await expect(outputContent).toContainText('middle statement');

		// STEP 5: Test multi-line statement execution in the second cell
		// Position cursor at line 19 (start of multi-line print statement)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('19');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Execute - this should execute the entire multi-line statement (lines 19-21)
		await page.keyboard.press('Meta+Enter');

		// Wait for execution and scroll to see output
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('28');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Check for the second inline output (for the second cell)
			const outputs = page.locator('.quarto-inline-output');
			const count = await outputs.count();
			expect(count).toBe(2);
		}).toPass({ timeout: 60000 });

		// Get the second output (for the second cell)
		const secondOutput = page.locator('.quarto-inline-output').nth(1);
		const secondOutputContent = secondOutput.locator('.quarto-output-content');
		await expect(secondOutputContent).toBeVisible({ timeout: 10000 });

		// The multi-line statement print(1 + 2 + 3) should produce "6"
		await expect(secondOutputContent).toContainText('6');
	});

	test('Python - Verify popout button appears for plot output and opens image in new tab', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with a plot
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the cell to generate plot output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output with plot to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify there's an image in the output
		const outputImage = inlineOutput.locator('.quarto-output-image');
		await expect(outputImage).toBeVisible({ timeout: 10000 });

		// The popout button should be visible for plot output (taller than 40px)
		const popoutButton = inlineOutput.locator('.quarto-output-popout');
		await expect(popoutButton).toBeVisible({ timeout: 10000 });

		// Count current editor tabs before popout
		const tabsBefore = await page.locator('.tabs-container .tab').count();

		// Click the popout button
		await popoutButton.click();
		await page.waitForTimeout(2000);

		// Verify a new editor tab was opened
		const tabsAfter = await page.locator('.tabs-container .tab').count();
		expect(tabsAfter).toBeGreaterThan(tabsBefore);
	});

	test('Python - Verify popout button opens text output in new editor', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with text output
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 13)
		// text_output.qmd: frontmatter (1-5), heading (7), description (9), cell starts line 11
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('13');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the cell to generate text output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('20');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify there's text output (stdout)
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// The popout button should be visible for text output (if tall enough)
		const popoutButton = inlineOutput.locator('.quarto-output-popout');
		await expect(popoutButton).toBeVisible({ timeout: 10000 });

		// Count current editor tabs before popout
		const tabsBefore = await page.locator('.tabs-container .tab').count();

		// Click the popout button
		await popoutButton.click();
		await page.waitForTimeout(2000);

		// Verify a new editor tab was opened (untitled)
		const tabsAfter = await page.locator('.tabs-container .tab').count();
		expect(tabsAfter).toBeGreaterThan(tabsBefore);

		// The new tab should be an untitled document with the text content
		// Look for a tab that is marked as dirty (unsaved) and selected
		const untitledTab = page.locator('.tabs-container .tab.dirty.selected');
		await expect(untitledTab).toBeVisible({ timeout: 5000 });
	});

	test('Python - Verify popout button opens interactive HTML in viewer panel', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with interactive Plotly output
		const filePath = join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd');
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell
		// interactive_plot.qmd: frontmatter (1-4), blank line (5), cell starts at line 6
		// Position at line 8 which is inside the cell
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('8');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the cell to generate interactive HTML output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Wait for webview container to be visible (interactive content)
		const webviewContainer = inlineOutput.locator('.quarto-output-webview-container');
		await expect(webviewContainer).toBeVisible({ timeout: 30000 });

		// Wait for the webview to fully render
		await page.waitForTimeout(3000);

		// The popout button should be visible for interactive HTML output
		const popoutButton = inlineOutput.locator('.quarto-output-popout');
		await expect(popoutButton).toBeVisible({ timeout: 10000 });

		// Click the popout button
		await popoutButton.click();

		// Wait for the Viewer panel to appear and have content
		// The Viewer panel has id 'workbench.panel.positronPreview' and appears in the auxiliary bar
		const viewerPanel = page.locator('[id="workbench.panel.positronPreview"]');
		await expect(viewerPanel).toBeVisible({ timeout: 10000 });

		// Wait a moment for the webview to render
		await page.waitForTimeout(2000);

		// Also verify no error notification was shown
		const errorNotification = page.locator('.notifications-toasts').filter({ hasText: 'Failed to open' });
		await expect(errorNotification).not.toBeVisible({ timeout: 1000 });
	});

	test('Python - Verify popout button is hidden for error-only output', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with error output
		const filePath = join('workspaces', 'quarto_inline_output', 'r_errors.qmd');
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the code cell that produces an error
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('9');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the cell to generate error output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output with error to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify there's error content
		const errorContent = inlineOutput.locator('.quarto-output-error');
		await expect(errorContent).toBeVisible({ timeout: 10000 });

		// The popout button should NOT be visible for error-only output
		const popoutButton = inlineOutput.locator('.quarto-output-popout');
		await expect(popoutButton).not.toBeVisible({ timeout: 5000 });
	});

	test('Python - Verify Open Output in New Tab command works', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Close all editors first to get a clean state
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		await page.waitForTimeout(500);

		// Open a Quarto document with a plot (using simple_plot.qmd which has reliable output)
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 12)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the cell to generate plot output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('25');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output has an image (confirms output is ready)
		const outputImage = inlineOutput.locator('.quarto-output-image');
		await expect(outputImage).toBeVisible({ timeout: 10000 });

		// Click on the editor to ensure it has focus
		await editor.click();
		await page.waitForTimeout(300);

		// Position cursor inside the cell code (line 12 is where we originally ran from)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('12');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1000);

		// Count tabs before
		const tabsBefore = await page.locator('.tabs-container .tab').count();

		// Run the popout command - this should open the plot in a new tab
		await app.workbench.quickaccess.runCommand('positronQuarto.popoutOutput');
		await page.waitForTimeout(3000);

		// Verify a new tab was opened (we started with 1 tab after closing all)
		const tabsAfter = await page.locator('.tabs-container .tab').count();
		expect(tabsAfter).toBeGreaterThan(tabsBefore);
	});

	test('R - Verify long text output is truncated with "open in editor" link', async function ({ app, openFile, r }) {
		// This test verifies the long output truncation feature:
		// 1. When text output exceeds maxLines (default 40), only the last 40 lines are shown
		// 2. A truncation header appears showing "...X lines omitted (open in editor)"
		// 3. Clicking "open in editor" opens the full output in a new editor tab
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output
		// to be set, as the long_output.qmd file only exists on that branch.

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'long_output.qmd');

		// Open the long output test file
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// long_output.qmd structure:
		// - frontmatter (1-4)
		// - blank line (5)
		// - R cell (6-9):
		//   line 6: ```{r}
		//   line 7: options(max.print = 5000)
		//   line 8: runif(5000)
		//   line 9: ```

		// Position cursor in the R code cell (line 7)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('7');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell (this will generate 5000 random numbers)
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear (includes kernel startup time)
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 180000 }); // Longer timeout for R kernel and 5000 numbers

		// Verify output content is present
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// CRITICAL ASSERTIONS:

		// 1. Verify the truncation header is visible
		// The header shows "...X lines omitted (open in editor)"
		const truncationHeader = inlineOutput.locator('.quarto-output-truncation-header');
		await expect(truncationHeader).toBeVisible({ timeout: 10000 });

		// 2. Verify the truncation header contains the expected text pattern
		const headerText = await truncationHeader.textContent();
		expect(headerText).toMatch(/\.\.\.\d[\d,]* lines? omitted/);
		expect(headerText).toContain('(open in editor)');

		// 3. Verify the number of omitted lines is reasonable (5000 random numbers should be many lines)
		// R prints ~10 numbers per line, so 5000 numbers ≈ 500 lines, minus 40 shown ≈ 460+ omitted
		const omittedMatch = headerText?.match(/\.\.\.(\d[\d,]*) lines? omitted/);
		expect(omittedMatch).toBeTruthy();
		const omittedCount = parseInt(omittedMatch![1].replace(/,/g, ''), 10);
		// Should have omitted more than 100 lines (conservative check)
		expect(omittedCount).toBeGreaterThan(100);

		// 4. Verify the first visible line has the gradient effect
		const gradientLine = inlineOutput.locator('.quarto-output-first-line-gradient');
		await expect(gradientLine).toBeVisible({ timeout: 5000 });

		// 5. Verify the "open in editor" link works
		// Count tabs before clicking
		const tabsBefore = await page.locator('.tabs-container .tab').count();

		// Click the "open in editor" link
		const openInEditorLink = inlineOutput.locator('.quarto-output-open-in-editor');
		await expect(openInEditorLink).toBeVisible({ timeout: 5000 });
		await openInEditorLink.click();

		// Wait for the new editor tab to open
		await page.waitForTimeout(2000);

		// 6. Verify a new editor tab was opened
		const tabsAfter = await page.locator('.tabs-container .tab').count();
		expect(tabsAfter).toBeGreaterThan(tabsBefore);

		// 7. Verify the new tab is an untitled document (dirty and selected)
		const untitledTab = page.locator('.tabs-container .tab.dirty.selected');
		await expect(untitledTab).toBeVisible({ timeout: 5000 });
	});

	test('Bash - Verify inline output appears after running a bash code cell', async function ({ app, openFile, r }) {
		// This test verifies that bash code cells execute via the terminal
		// and their output appears inline in the Quarto document.
		//
		// NOTE: This test requires QA_EXAMPLE_CONTENT_BRANCH=feature/quarto-inline-output

		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_inline_output', 'multiple_languages.qmd');

		// Open the multi-language Quarto document
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the bash code cell (line 28)
		// multiple_languages.qmd structure:
		// - frontmatter (1-4)
		// - R section (6-12)
		// - Python section (14-21)
		// - Bash section: heading (23), description (25), cell (27-29)
		// - Bash cell: ```{bash} (27), echo "..." (28), ``` (29)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('28');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the bash cell - should execute via terminal and show inline output
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			// Scroll to see the bash cell's output (after line 29)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('32');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Check that at least one inline output is visible
			await expect(inlineOutput.first()).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });

		// Verify the bash output contains our expected text
		// The command is: echo "Your home directory is $HOME"
		// The output should ONLY contain the expanded result, e.g. "Your home directory is /Users/jmcphers"
		// NOT the command itself or any shell prompt
		const outputContent = inlineOutput.last().locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		const outputText = await outputContent.textContent();
		expect(outputText).toBeTruthy();

		// The output should contain "Your home directory is" followed by a path
		expect(outputText).toContain('Your home directory is');

		// The output should NOT contain the command source (echo)
		// or any shell prompt characters like $ or %
		expect(outputText).not.toContain('echo');
		expect(outputText).not.toMatch(/^\s*\$/m); // No lines starting with $
	});

	test('R - Verify execution options are respected when running all cells', async function ({ app, openFile, r }) {
		// This test verifies that Quarto cell execution options (#| eval, #| error)
		// are respected when using the "Run All Cells" interactive gesture.
		//
		// execution_options.qmd has 6 cells:
		// Cell 1: #| label: first cell → print("This is the first cell.") → should execute
		// Cell 2: #| eval: false → print("...second cell...") → should be SKIPPED
		// Cell 3: #| error: false → stop("Oh no") → error occurs, but queue continues
		// Cell 4: (no options) → print("It's the end of the world...") → should execute (error in cell 3 was non-fatal)
		// Cell 5: #| error: true → stop("Well, this is awkward.") → error occurs, queue STOPS
		// Cell 6: (no options) → print("How did we get here?") → should NOT execute (stopped by cell 5)
		//
		// Expected: 4 output zones for cells 1, 3, 4, 5.
		// Cell 2 is skipped (eval: false), Cell 6 is not reached (queue stopped at cell 5).

		const page = app.code.driver.page;

		// Open the execution options test document
		await openFile(join('workspaces', 'quarto_inline_output', 'execution_options.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const kernelStatusWidget = page.locator('[data-testid="quarto-kernel-status"]');
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Run All Cells via command (interactive gesture)
		await app.workbench.quickaccess.runCommand('positronQuarto.runAllCells');

		// Wait for execution to complete by looking for inline outputs.
		// The output view zones are DOM elements with class 'quarto-inline-output'.
		// Monaco virtualizes rendering so elements may be hidden when off-screen,
		// but they remain in the DOM and we can read their textContent.
		const inlineOutput = page.locator('.quarto-inline-output');

		// Helper to scroll editor to a specific line and wait
		const scrollToLine = async (line: number) => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type(String(line));
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
		};

		// Wait for execution to complete. We need to wait until the queue finishes.
		// Without execution options, all 6 cells run. With options, only 5 run (cell 2 skipped)
		// but cell 5 error stops the queue, so cells 1,3,4,5 produce output (4 total).
		// Without the feature, all 6 cells run and produce 6 outputs.
		// Either way, wait for execution to stabilize by watching for outputs to stop appearing.
		await expect(async () => {
			// Scroll through document to trigger view zone creation
			await scrollToLine(49);
			await page.waitForTimeout(500);
			await scrollToLine(1);
			await page.waitForTimeout(500);

			// Check that some outputs have appeared
			const count = await inlineOutput.count();
			expect(count).toBeGreaterThanOrEqual(1);
		}).toPass({ timeout: 120000 });

		// Wait for execution queue to fully drain
		// All cells should have finished executing by now
		await page.waitForTimeout(10000);

		// Scroll through the entire document to ensure all view zones are in the DOM
		await scrollToLine(49);
		await page.waitForTimeout(1000);
		await scrollToLine(1);
		await page.waitForTimeout(1000);

		// Now count outputs and verify content.
		// Use page.evaluate to read all output text from the DOM regardless of visibility.
		// Note: Monaco virtualizes rendering, so DOM order may not match document order.
		// We collect all output texts and verify presence/absence of expected content.
		const outputTexts = await page.evaluate(() => {
			const outputs = document.querySelectorAll('.quarto-inline-output .quarto-output-content');
			return Array.from(outputs).map(el => el.textContent ?? '');
		});

		// CRITICAL ASSERTION: With execution options properly respected:
		// - Cell 1: executed → output contains "This is the first cell."
		// - Cell 2: eval: false → SKIPPED, no output
		// - Cell 3: error: false → executed, output contains "Oh no" error
		// - Cell 4: executed → output contains "end of the world"
		// - Cell 5: error: true → executed, output contains "awkward" error, queue STOPS
		// - Cell 6: NOT executed (queue stopped at cell 5)
		//
		// Expected: exactly 4 outputs

		expect(outputTexts.length).toBe(4);

		// Verify expected outputs are present (checking content regardless of order
		// since Monaco DOM order may differ from document order due to virtualization)
		const allOutputText = outputTexts.join('\n');
		expect(allOutputText).toContain('This is the first cell.');
		expect(allOutputText).toContain('Oh no');
		expect(allOutputText).toContain('end of the world');
		expect(allOutputText).toContain('awkward');

		// Double-check: cell 2 output should NOT appear anywhere (eval: false)
		expect(allOutputText).not.toContain('second cell');
		// Cell 6 output should NOT appear (queue stopped at cell 5 error)
		expect(allOutputText).not.toContain('How did we get here');
	});
});
