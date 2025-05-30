/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook Cell Execution with raises-exception tag', {
	tag: [tags.NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {
	test.describe('Python Notebooks', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Execution stops at exception without raises-exception tag', async function ({ app, page }) {
			// Cell 1: Normal execution
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 1 executed")');

			// Cell 2: Exception without tag (should stop execution)
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('raise ValueError("This should stop execution")', 1);

			// Cell 3: Should NOT execute
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 3 should not execute")', 2);

			// Run all cells
			await app.workbench.notebooks.runAllCells();

			// Verify outputs
			await app.workbench.notebooks.assertCellOutput('Cell 1 executed');
			await app.workbench.notebooks.assertCellOutput('ValueError: This should stop execution');

			// Cell 3 should have no output
			const cell3Output = page.locator('.cell-inner-container > .cell').nth(2).locator('.output');
			await expect(cell3Output).not.toBeVisible();
		});

		test('Python - Execution continues after exception with raises-exception tag', async function ({ app, page }) {
			// Cell 1: Normal execution
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 1 executed")');

			// Cell 2: Exception with raises-exception tag
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('raise ValueError("Expected error - execution should continue")', 1);

			// Add raises-exception tag to Cell 2
			// First, ensure the cell is selected
			await page.locator('.cell-inner-container > .cell').nth(1).click();

			// Run the add tag command
			await app.workbench.quickaccess.runCommand('jupyter-cell-tags.addTag', { keepOpen: true });

			// Type the tag name in the quick input
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.type('raises-exception');
			// Press Enter key to submit (there's no okay button to press)
			page.keyboard.press('Enter');

			// Cell 3: Should execute despite Cell 2 error
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 3 executed successfully!")', 2);

			// Run all cells by clicking the "Run All" button
			await app.workbench.notebooks.runAllCells();

			// Verify outputs
			await app.workbench.notebooks.assertCellOutput('Cell 1 executed');
			await app.workbench.notebooks.assertCellOutput('ValueError: Expected error - execution should continue');
			await app.workbench.notebooks.assertCellOutput('Cell 3 executed successfully!');
		});
	});
});
