/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Execution', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Verify running cell after editing content works via toolbar', async function ({ python, app, page, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'editable_cell.qmd'));
		await editors.waitForActiveTab('editable_cell.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Position cursor and run via toolbar
		await editors.clickTab('editable_cell.qmd');
		await quartoInlineOutput.gotoLine(13);
		await quartoInlineOutput.clickToolbarRunButton(0);
		await quartoInlineOutput.expectOutputVisible();

		// Edit the cell
		await quartoInlineOutput.gotoLine(13);
		await page.keyboard.press('End');
		await page.keyboard.type('  # test comment');
		await page.waitForTimeout(1000);

		// Run again via toolbar
		await quartoInlineOutput.clickToolbarRunButton(0);
		await quartoInlineOutput.gotoLine(20);
		await quartoInlineOutput.expectOutputVisible();
	});

	test('Python - Verify cell execution uses correct line numbers after document edits', async function ({ python, app, page, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'editable_cell.qmd'));
		await editors.waitForActiveTab('editable_cell.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run all cells
		await editors.clickTab('editable_cell.qmd');
		await quartoInlineOutput.runAllCells();

		// Wait for both outputs
		await quartoInlineOutput.gotoLine(25);
		await quartoInlineOutput.expectOutputsExist(2);

		// Verify both outputs visible
		await quartoInlineOutput.gotoLine(18);
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectOutputVisible({ index: 1 });

		// Insert text between cells
		await quartoInlineOutput.gotoLine(17);
		await page.keyboard.press('Home');
		await page.keyboard.type(`This is some new text inserted between cells.
Adding more lines to shift the second cell down.
One more line for good measure.
`);

		// Run the second cell (now at different line)
		await quartoInlineOutput.gotoLine(25);
		await quartoInlineOutput.runCurrentCell();

		// Verify no errors and output is correct
		await quartoInlineOutput.gotoLine(30);
		await quartoInlineOutput.expectOutputVisible({ index: 1 });
		await quartoInlineOutput.expectErrorCount(0);

		// Verify the output content is correct (the second output should be a PID)
		const outputText = await quartoInlineOutput.getOutputItemAt(1).textContent();
		const pid = parseInt(outputText?.trim() ?? '', 10);
		expect(pid).toBeGreaterThan(0);
	});

	test('Python - Verify cancel button removes queued cell from execution queue', async function ({ python, app, page, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'cancel_execution.qmd'));
		await editors.waitForActiveTab('cancel_execution.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Position at second cell and run all
		await editors.clickTab('cancel_execution.qmd');
		const secondToolbarRunButton = quartoInlineOutput.cellToolbar.nth(1).locator('.quarto-toolbar-run');

		// Run all cells and verify second cell is queued
		await quartoInlineOutput.gotoLine(17);
		await quartoInlineOutput.runAllCells();
		await expect(secondToolbarRunButton).toBeVisible({ timeout: 5000 });
		await expect(secondToolbarRunButton).toHaveClass(/queued/, { timeout: 5000 });

		// Cancel the queued cell
		await secondToolbarRunButton.click();

		// Wait for first cell to complete
		await page.waitForTimeout(4000);

		// Verify first cell output
		await quartoInlineOutput.gotoLine(14);
		await quartoInlineOutput.expectOutputVisible({ timeout: 120000 });
		await quartoInlineOutput.expectOutputContainsText("Time's up");

		// Verify only one output (second cell was cancelled)
		await quartoInlineOutput.expectOutputsExist(1);

		// Verify no "Oh no" text from cancelled cell
		const allOutputText = await quartoInlineOutput.inlineOutput.allTextContents();
		const hasOhNo = allOutputText.some(text => text.includes('Oh no'));
		expect(hasOhNo).toBe(false);
	});
});
