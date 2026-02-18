/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Multi-Cell Execution', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.afterEach(async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.expectNoActiveSpinners();
	});

	test('Multi-select + Shift+Enter runs all selected code cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 3 code cells containing executable Python
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.kernel.select('Python');

		// Put executable code in each cell
		await notebooksPositron.selectCellAtIndex(0);
		await keyboard.press('Enter');
		await keyboard.type('1 + 1');

		await notebooksPositron.selectCellAtIndex(1);
		await keyboard.press('Enter');
		await keyboard.type('2 + 2');

		await notebooksPositron.selectCellAtIndex(2);
		await keyboard.press('Enter');
		await keyboard.type('3 + 3');

		// Multi-select all 3 cells: select cell 0, then Shift+ArrowDown twice
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([0, 1, 2]);

		// Press Shift+Enter to run all selected cells
		await keyboard.press('Shift+Enter');

		// Verify all 3 cells got execution order badges
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
			{ index: 2, order: 3 },
		]);

		// Verify multi-selection is preserved
		await notebooksPositron.expectCellsToBeSelected([0, 1, 2]);
	});

	test('Mixed selection skips markdown cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 2 code cells then 1 markdown cell
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });
		await notebooksPositron.kernel.select('Python');

		// Put executable code in each code cell
		await notebooksPositron.selectCellAtIndex(0);
		await keyboard.press('Enter');
		await keyboard.type('10 + 10');

		await notebooksPositron.selectCellAtIndex(1);
		await keyboard.press('Enter');
		await keyboard.type('20 + 20');

		// Multi-select all 3 cells (2 code + 1 markdown)
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([0, 1, 2]);

		// Press Shift+Enter to run selected cells
		await keyboard.press('Shift+Enter');

		// Verify only code cells got execution badges (markdown cells don't
		// render the execution-order-badge element, so we only check code cells)
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
		]);

		// Verify multi-selection is preserved
		await notebooksPositron.expectCellsToBeSelected([0, 1, 2]);
	});

	test('Single-cell Shift+Enter still executes and selects below', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 2 code cells
		await notebooksPositron.newNotebook({ codeCells: 2 });
		await notebooksPositron.kernel.select('Python');

		// Put executable code in cell 0
		await notebooksPositron.selectCellAtIndex(0);
		await keyboard.press('Enter');
		await keyboard.type('1 + 1');

		// Execute single cell with Shift+Enter
		await keyboard.press('Shift+Enter');

		// Verify cell 0 executed and selection moved to cell 1 (not multi-selected)
		await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
		await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: false });
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
	});
});
