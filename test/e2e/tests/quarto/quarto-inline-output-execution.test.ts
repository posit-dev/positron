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
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'editable_cell.qmd'));
		await editors.waitForActiveTab('editable_cell.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Position cursor and run via toolbar
		await editors.clickTab('editable_cell.qmd');
		await inlineQuarto.gotoLine(13);
		await inlineQuarto.clickToolbarRunButton(0);
		await inlineQuarto.expectOutputVisible();

		// Edit the cell
		await inlineQuarto.gotoLine(13);
		await page.keyboard.press('End');
		await page.keyboard.type('  # test comment');
		await page.waitForTimeout(1000);

		// Run again via toolbar
		await inlineQuarto.clickToolbarRunButton(0);
		await inlineQuarto.gotoLine(20);
		await inlineQuarto.expectOutputVisible();
	});

	test('Python - Verify cell execution uses correct line numbers after document edits', async function ({ python, app, page, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'editable_cell.qmd'));
		await editors.waitForActiveTab('editable_cell.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run all cells
		await editors.clickTab('editable_cell.qmd');
		await inlineQuarto.runAllCells();

		// Wait for both outputs
		await inlineQuarto.gotoLine(25);
		await inlineQuarto.expectOutputsExist(2);

		// Verify both outputs visible
		await inlineQuarto.gotoLine(18);
		await inlineQuarto.expectOutputVisible();
		await inlineQuarto.expectOutputVisible({ index: 1 });

		// Insert text between cells
		await inlineQuarto.gotoLine(17);
		await page.keyboard.press('Home');
		await page.keyboard.type(`This is some new text inserted between cells.
Adding more lines to shift the second cell down.
One more line for good measure.
`);

		// Run the second cell (now at different line)
		await inlineQuarto.gotoLine(25);
		await inlineQuarto.runCurrentCode();

		// Verify no errors and output is correct
		await inlineQuarto.gotoLine(30);
		await inlineQuarto.expectOutputVisible({ index: 1 });
		await inlineQuarto.expectErrorCount(0);

		// Verify the output content is correct (the second output should be a PID)
		const outputText = await inlineQuarto.getOutputItemAt(1).textContent();
		const pid = parseInt(outputText?.trim() ?? '', 10);
		expect(pid).toBeGreaterThan(0);
	});

	test('Python - Verify cancel button removes queued cell from execution queue', async function ({ python, app, page, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'cancel_execution.qmd'));
		await editors.waitForActiveTab('cancel_execution.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Position at second cell and run all
		await editors.clickTab('cancel_execution.qmd');
		const secondToolbarRunButton = inlineQuarto.cellToolbar.nth(1).locator('.quarto-toolbar-run');

		// Run all cells and verify second cell is queued
		await inlineQuarto.gotoLine(17);
		await inlineQuarto.runAllCells();
		await expect(secondToolbarRunButton).toBeVisible({ timeout: 5000 });
		await expect(secondToolbarRunButton).toHaveClass(/queued/, { timeout: 5000 });

		// Cancel the queued cell
		await secondToolbarRunButton.click();

		// Wait for first cell to complete
		await page.waitForTimeout(4000);

		// Verify first cell output
		await inlineQuarto.gotoLine(14);
		await inlineQuarto.expectOutputVisible({ timeout: 120000 });
		await inlineQuarto.expectOutputContainsText('Time\'s up');

		// Verify only one output (second cell was cancelled)
		await inlineQuarto.expectOutputsExist(1);

		// Verify no "Oh no" text from cancelled cell
		const allOutputText = await inlineQuarto.inlineOutput.allTextContents();
		const hasOhNo = allOutputText.some(text => text.includes('Oh no'));
		expect(hasOhNo).toBe(false);
	});
});
