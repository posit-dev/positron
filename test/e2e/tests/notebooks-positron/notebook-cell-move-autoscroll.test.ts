/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

// 12 cells should be enough for scrolling to be triggered (#12413)
const CELL_COUNT = 12;
const LAST_INDEX = CELL_COUNT - 1;

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Move Auto-Scroll', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Moving a cell off-screen auto-scrolls the destination into view', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.currentPage;

		// Reset mouse state in case a previous test left a button pressed
		await page.mouse.up();

		await notebooksPositron.newNotebook({ codeCells: CELL_COUNT });

		await test.step('Drag (mouse) the top cell to the bottom auto-scrolls it into view', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await expect(notebooksPositron.cell.nth(LAST_INDEX)).not.toBeInViewport();

			try {
				await notebooksPositron.dragCellToPositionWithScroll(0, LAST_INDEX);
			} finally {
				await page.mouse.up();
			}

			await expect(notebooksPositron.cell.nth(LAST_INDEX)).toBeInViewport();
			await notebooksPositron.expectCellContentAtIndexToBe(LAST_INDEX, '# Cell 0');
		});

		await test.step('Move (keyboard) the same cell back to the top auto-scrolls it into view', async () => {
			await notebooksPositron.selectCellAtIndex(LAST_INDEX, { editMode: false });
			await expect(notebooksPositron.cell.nth(0)).not.toBeInViewport();

			// Alt+ArrowUp moves the selected cell up one position
			for (let i = 0; i < LAST_INDEX; i++) {
				await page.keyboard.press('Alt+ArrowUp');
			}

			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
			await expect(notebooksPositron.cell.nth(0)).toBeInViewport();
		});
	});
});
