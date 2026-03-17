/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Notebook Cell Reordering', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Action Bar: swap 1st and 2nd cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Open an existing notebook to match manual testing scenario
		const notebookPath = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');
		await notebooksPositron.openNotebook(notebookPath);

		// Get initial cell count
		const initialCount = await notebooksPositron.getCellCount();
		expect(initialCount).toBeGreaterThan(2); // Need at least 3 cells to test moving

		// Get the content of the first three cells to verify order
		const cell0Content = await notebooksPositron.getCellContent(0);
		const cell1Content = await notebooksPositron.getCellContent(1);
		const cell2Content = await notebooksPositron.getCellContent(2);

		// Select "Move cell down"
		await notebooksPositron.triggerCellAction(0, 'Move cell down');

		// Verify cell moved down by EXACTLY ONE position
		await notebooksPositron.expectCellContentAtIndexToBe(0, cell1Content); // Former cell 1 is now at position 0
		await notebooksPositron.expectCellContentAtIndexToBe(1, cell0Content); // Former cell 0 is now at position 1
		await notebooksPositron.expectCellContentAtIndexToBe(2, cell2Content); // Cell 2 should be unchanged

		// Verify cell count hasn't changed
		await notebooksPositron.expectCellCountToBe(initialCount);
	});

	test('Keyboard: swap 1st and 2nd cell', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });

		// Verify initial order
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Select first cell and move down
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Alt+ArrowDown');

		// Verify cell moved down by exactly one position
		await notebooksPositron.expectCellCountToBe(3);
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
	});

	test('Boundaries: first-up and last-down are no-ops', async ({ app }) => {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// First cell up -> no change
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Last cell down -> no change
		await notebooksPositron.selectCellAtIndex(2, { editMode: false });
		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		await notebooksPositron.expectCellCountToBe(3);
	});

	test('Multi-move: move first to end then one up', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Setup: Create notebook with 4 cells
		await notebooksPositron.newNotebook({ codeCells: 4 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);

		// Move Cell 0 down three times to end
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2', '# Cell 3']);

		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0', '# Cell 3']);

		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 3', '# Cell 0']);

		// Now move it back up
		await keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0', '# Cell 3']);
	});

	test('Undo/redo cell move operation', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Setup: Create notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 3 });
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Move cell 1 up
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Alt+ArrowUp');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);

		// Undo the move
		await notebooksPositron.performCellAction('undo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);

		// Redo the move
		await notebooksPositron.performCellAction('redo');
		await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
	});

	test('Multiselect: move multiple cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create notebook with 5 cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 3 });

		// Select cells 1, 2, and 3
		await notebooksPositron.selectCellAtIndex(1, { editMode: false });
		await keyboard.press('Shift+ArrowDown');
		await keyboard.press('Shift+ArrowDown');
		await notebooksPositron.expectCellsToBeSelected([1, 2, 3]);

		// Move selected cells down
		await keyboard.press('Alt+ArrowDown');
		await keyboard.press('Alt+ArrowDown');
		await notebooksPositron.expectCellContentsToBe(['# Cell 0', '### Cell 4', '# Cell 1', '### Cell 2', '### Cell 3']);
	});

	// --- Drag-and-Drop Reordering Tests ---

	test('Drag-and-drop: single cell down by two positions', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook with 4 cells', async () => {
			await notebooksPositron.newNotebook({ codeCells: 4 });
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2', '# Cell 3']);
		});

		await test.step('Drag Cell 0 down by two positions', async () => {
			await notebooksPositron.dragCellToCell(0, 2, { targetPosition: { x: 0, y: 0 } });
			await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0', '# Cell 3']);
		});
	});

	test('Drag-and-drop: single cell up by one position', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook with 3 cells', async () => {
			await notebooksPositron.newNotebook({ codeCells: 3 });
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
		});

		await test.step('Drag Cell 1 up by one position', async () => {
			await notebooksPositron.dragCellToCell(1, 0, { targetPosition: { x: 0, y: 0 } });
			await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0', '# Cell 2']);
		});
	});

	test('Drag-and-drop: multiple selected cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		await test.step('Setup: Create notebook and select cells 1-2', async () => {
			await notebooksPositron.newNotebook({ codeCells: 5 });
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await keyboard.press('Shift+ArrowDown');
			await notebooksPositron.expectCellsToBeSelected([1, 2]);
		});

		await test.step('Drag selected cells down', async () => {
			await notebooksPositron.dragCellToCell(1, 4, { targetPosition: { x: 0, y: 0 } });
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 3', '# Cell 4', '# Cell 1', '# Cell 2']);
		});
	});

	test('Drag-and-drop: to top of notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook', async () => {
			await notebooksPositron.newNotebook({ codeCells: 3 });
		});

		await test.step('Drag last cell to top', async () => {
			await notebooksPositron.dragCellToCell(2, 0, { targetPosition: { x: 0, y: -10 } });
			await notebooksPositron.expectCellContentsToBe(['# Cell 2', '# Cell 0', '# Cell 1']);
		});
	});

	test('Drag-and-drop: to bottom of notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook', async () => {
			await notebooksPositron.newNotebook({ codeCells: 3 });
		});

		await test.step('Drag first cell to bottom', async () => {
			await notebooksPositron.dragCellToCell(0, 2, { targetPosition: { x: 0, y: 50 } });
			await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0']);
		});
	});

	test('Drag-and-drop: cancel with Escape key', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Setup: Create notebook', async () => {
			await notebooksPositron.newNotebook({ codeCells: 3 });
		});

		await test.step('Start drag and cancel with Escape', async () => {
			const sourceCell = notebooksPositron.cell.nth(0);
			const dragHandle = sourceCell.locator('.cell-drag-handle').first();

			// Start drag operation manually
			const sourceBbox = await dragHandle.boundingBox();
			expect(sourceBbox).not.toBeNull();

			await page.mouse.move(sourceBbox!.x + 5, sourceBbox!.y + 5);
			await page.mouse.down();
			await page.mouse.move(sourceBbox!.x + 5, sourceBbox!.y + 100);

			// Cancel drag with Escape
			await page.keyboard.press('Escape');
			await page.mouse.up();

			// Verify order unchanged
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
		});
	});

	test('Drag-and-drop: auto-scroll when dragging near edges', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Setup: Create notebook with many cells', async () => {
			await notebooksPositron.newNotebook({ codeCells: 15 });

			// Add content to ensure scrolling is needed
			for (let i = 0; i < 15; i++) {
				await notebooksPositron.addCodeToCell(i, `# Cell ${i}\nprint("line 2")\nprint("line 3")`);
			}
		});

		await test.step('Drag cell and verify auto-scroll near bottom edge', async () => {
			// Scroll to top first
			await notebooksPositron.cell.nth(0).scrollIntoViewIfNeeded();

			const sourceCell = notebooksPositron.cell.nth(0);
			const dragHandle = sourceCell.locator('.cell-drag-handle').first();
			const sourceBbox = await dragHandle.boundingBox();
			expect(sourceBbox).not.toBeNull();

			// Get viewport height
			const viewportSize = page.viewportSize();
			expect(viewportSize).not.toBeNull();

			// Start drag
			await page.mouse.move(sourceBbox!.x + 5, sourceBbox!.y + 5);
			await page.mouse.down();

			// Move near bottom edge to trigger auto-scroll
			const bottomEdgeY = viewportSize!.height - 50;
			await page.mouse.move(sourceBbox!.x + 5, bottomEdgeY);

			// Wait briefly for auto-scroll to trigger
			await page.waitForTimeout(500);

			// Verify that cells further down are now visible (indicating scroll occurred)
			const lastCellVisible = await notebooksPositron.cell.nth(14).isVisible();
			expect(lastCellVisible).toBe(true);

			// Complete drag
			await page.mouse.up();
		});
	});

	test('Drag-and-drop: undo/redo after drag operation', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook', async () => {
			await notebooksPositron.newNotebook({ codeCells: 3 });
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
		});

		await test.step('Drag cell', async () => {
			await notebooksPositron.dragCellToCell(0, 2, { targetPosition: { x: 0, y: 0 } });
			await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0']);
		});

		await test.step('Undo drag operation', async () => {
			await notebooksPositron.performCellAction('undo');
			await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell 2']);
		});

		await test.step('Redo drag operation', async () => {
			await notebooksPositron.performCellAction('redo');
			await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 2', '# Cell 0']);
		});
	});
});
