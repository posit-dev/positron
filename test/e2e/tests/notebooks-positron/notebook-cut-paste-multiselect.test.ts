/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cut/Paste with Multi-Cell Selection', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('cut with multi-cell selection should only remove selected cells, not extra cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4']);

		// Select cells 1, 2, and 3 (middle cells)
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2, 3]);

		// Cut selected cells
		await notebooksPositron.performCellAction('cut');

		// Verify ONLY selected cells are removed (cells 1, 2, 3)
		// Cell 4 should NOT be removed
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4']);

		// Paste the cut cells
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.performCellAction('paste');

		// Verify ALL originally selected cells are pasted (not just cell 4)
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4', '# Cell 1', '# Cell 2', '# Cell 3']);
	});

	test('cut with contiguous selection at beginning should work correctly', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });

		// Select first 3 cells
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([0, 1, 2]);

		// Cut selected cells
		await notebooksPositron.performCellAction('cut');

		// Verify only cells 0, 1, 2 removed; cells 3, 4 remain
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 3', '# Cell 4']);

		// Paste at the end
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.performCellAction('paste');

		// Verify all 3 cut cells are pasted
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellContentsToBe(['# Cell 3', '# Cell 4', '# Cell 0', '# Cell 1', '# Cell 2']);
	});

	test('cut with contiguous selection at end should work correctly', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });

		// Select last 3 cells (cells 2, 3, 4)
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([2, 3, 4]);

		// Cut selected cells
		await notebooksPositron.performCellAction('cut');

		// Verify only cells 2, 3, 4 removed; cells 0, 1 remain
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);

		// Paste at the beginning
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.performCellAction('paste');

		// Verify all 3 cut cells are pasted
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 2', '# Cell 3', '# Cell 4', '# Cell 1']);
	});

	test('cut/paste should preserve cell types in multi-selection', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with mixed cell types
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 2 });
		await notebooksPositron.expectCellCountToBe(4);

		// Add a final code cell
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(4, '# Cell 4');
		await notebooksPositron.expectCellCountToBe(5);

		// Select cells 1, 2, 3 (code, markdown, markdown)
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2, 3]);

		// Cut selected cells
		await notebooksPositron.performCellAction('cut');

		// Verify correct cells remain
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4']);

		// Paste the cut cells
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.performCellAction('paste');

		// Verify all cells pasted with correct types
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellTypeAtIndexToBe(0, 'code');
		await notebooksPositron.expectCellTypeAtIndexToBe(1, 'code');
		await notebooksPositron.expectCellTypeAtIndexToBe(2, 'code');
		await notebooksPositron.expectCellTypeAtIndexToBe(3, 'markdown');
		await notebooksPositron.expectCellTypeAtIndexToBe(4, 'markdown');
	});

	test('cut/paste multiple times should work correctly', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 6 cells
		await notebooksPositron.newNotebook({ codeCells: 6 });

		// First cut: cells 1-2
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2]);
		await notebooksPositron.performCellAction('cut');
		await notebooksPositron.expectCellCountToBe(4);

		// Paste at end
		await notebooksPositron.selectCellAtIndex(3, { editMode: false });
		await notebooksPositron.performCellAction('paste');
		await notebooksPositron.expectCellCountToBe(6);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 3', '# Cell 4', '# Cell 5', '# Cell 1', '# Cell 2']);

		// Second cut: cells 0-1
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([0, 1]);
		await notebooksPositron.performCellAction('cut');
		await notebooksPositron.expectCellCountToBe(4);

		// Paste in middle
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.performCellAction('paste');
		await notebooksPositron.expectCellCountToBe(6);
		await notebooksPositron.expectCellContentsToBe(['# Cell 4', '# Cell 5', '# Cell 0', '# Cell 3', '# Cell 1', '# Cell 2']);
	});

	test('undo/redo should work correctly after cut/paste with multi-selection', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 5 });
		const originalCells = ['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3', '# Cell 4'];
		await notebooksPositron.expectCellContentsToBe(originalCells);

		// Select and cut cells 1-3
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.performCellAction('cut');
		await notebooksPositron.expectCellCountToBe(2);

		// Undo the cut
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellContentsToBe(originalCells);

		// Redo the cut
		await hotKeys.redo();
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4']);

		// Paste
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await notebooksPositron.performCellAction('paste');
		await notebooksPositron.expectCellCountToBe(5);

		// Undo the paste
		await hotKeys.undo();
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4']);

		// Redo the paste
		await hotKeys.redo();
		await notebooksPositron.expectCellCountToBe(5);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4', '# Cell 1', '# Cell 2', '# Cell 3']);
	});
});
