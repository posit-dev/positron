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

	test('R - Verify multi-language document executes non-primary language in console', async function ({ app, openFile, r, python }) {
		// This test verifies that in a multi-language Quarto document:
		// 1. The primary language (R) cells execute inline via the kernel
		// 2. Non-primary language (Python) cells execute via the console service
		//
		// This ensures users can work with documents containing multiple languages
		// without being blocked by a warning toast.
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
		await expect(outputContent).toBeVisible({ timeout: 10000 });
		await expect(outputContent).toContainText('Hello from R');

		// STEP 2: Run the Python cell (non-primary language - should execute in console)
		// Position cursor in the Python code cell (line 21)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('21');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the Python cell - this should NOT show a warning toast, and should
		// execute the code via the console service
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for Python console to show output
		// The Python code is: import os; os.getpid()
		// The output should appear in the Python console, not inline
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

		// Verify there's still only ONE inline output (from R), not two
		// This confirms the Python code went to console, not inline
		await app.workbench.quickaccess.runCommand('workbench.action.focusActiveEditorGroup');
		await page.waitForTimeout(500);

		// Scroll back to see inline outputs
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('14');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Count inline outputs - should be exactly 1 (the R output)
		const inlineOutputCount = await inlineOutput.count();
		expect(inlineOutputCount).toBe(1);
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

			await page.waitForTimeout(1500); // Wait for document to parse

			// Click the run button on the cell toolbar
			const cellToolbar = page.locator('.quarto-cell-toolbar');
			await expect(cellToolbar.first()).toBeVisible({ timeout: 10000 });
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

			// Wait for output to update
			await page.waitForTimeout(3000);

			// Scroll to see the output
			const inlineOutput = page.locator('.quarto-inline-output');
			await expect(async () => {
				await runCommand('workbench.action.gotoLine', { keepOpen: true });
				await page.keyboard.type('12');
				await page.keyboard.press('Enter');
				await page.waitForTimeout(500);
				await expect(inlineOutput).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 30000 });

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
		await page.waitForTimeout(2000);

		// Step 5: We should be on the second document (last opened). Get its PID.
		const pid2After = await getPidFromCurrentDoc();

		// Step 6: Switch to the first document and get its PID
		// Use Ctrl+Tab or the editor tabs to switch
		await runCommand('workbench.action.previousEditor');
		await page.waitForTimeout(1000);
		await expect(kernelStatusWidget.first()).toBeVisible({ timeout: 30000 });

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

		// Scroll to where output should be
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('15');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// CRITICAL CHECK AFTER RELOAD: The output should STILL be rendered as HTML/webview,
		// NOT as a JSON blob.
		await expect(webviewOrHtml.first()).toBeVisible({ timeout: 10000 });

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

		// Verify both outputs are visible
		await expect(inlineOutputs.nth(0)).toBeVisible({ timeout: 10000 });
		await expect(inlineOutputs.nth(1)).toBeVisible({ timeout: 10000 });

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
});
