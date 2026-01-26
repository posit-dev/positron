/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
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
});
