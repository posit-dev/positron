/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

// Not running on web due to Positron notebooks being desktop-only
test.describe('Notebook Focus and Selection', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.configure(settings, {
			editor: 'positron',
			reload: true,
		});
	});

	test.beforeEach(async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.newNotebook(5);
		await notebooksPositron.expectCellCountToBe(5);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Notebook keyboard behavior with cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Test 1: Arrow Down navigation moves focus to next cell', async () => {
			await notebooksPositron.selectCellAtIndex(1, { exitEditMode: true });
			await app.code.driver.page.keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});

		await test.step('Test 2: Arrow Up navigation moves focus to previous cell', async () => {
			await notebooksPositron.selectCellAtIndex(3, { exitEditMode: true });
			await app.code.driver.page.keyboard.press('ArrowUp');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});

		await test.step('Test 3: Arrow Down at last cell does not change selection', async () => {
			await notebooksPositron.selectCellAtIndex(4, { exitEditMode: true });
			await app.code.driver.page.keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(4, { inEditMode: false });
		});

		await test.step('Test 4: Arrow Up at first cell does not change selection', async () => {
			await notebooksPositron.selectCellAtIndex(0, { exitEditMode: true });
			await app.code.driver.page.keyboard.press('ArrowUp');
			await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });
		});

		await test.step('Test 5: Shift+Arrow Down adds next cell to selection', async () => {
			await notebooksPositron.selectCellAtIndex(1, { exitEditMode: true });
			await app.code.driver.page.keyboard.press('Shift+ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});

		await test.step('Test 6: Focus is maintained across multiple navigation operations', async () => {
			await notebooksPositron.selectCellAtIndex(0, { exitEditMode: true });

			// Navigate down multiple times
			await app.code.driver.page.keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });

			await app.code.driver.page.keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });

			await app.code.driver.page.keyboard.press('ArrowDown');
			await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: false });

			// Navigate up
			await app.code.driver.page.keyboard.press('ArrowUp');
			await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
		});
	});

	test('Editor mode behavior with notebook cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Test 1: Clicking into cell focuses editor and enters edit mode', async () => {
			// Clicking on cell should focus and enter edit mode
			await notebooksPositron.selectCellAtIndex(1);
			await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: false, inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(1, { isSelected: true, inEditMode: true });
			await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: false, inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: false, inEditMode: false });
			await notebooksPositron.expectCellIndexToBeSelected(4, { isSelected: false, inEditMode: false });

			// Verify we can type into the editor after clicking
			await app.code.driver.page.keyboard.type('# editor good');
			await notebooksPositron.expectCellContentAtIndexToContain(1, '# editor good');
		});

		await test.step('Test 2: Enter key on selected cell enters edit mode and doesn\'t add new lines', async () => {
			// Verify pressing Enter enters edit mode
			await notebooksPositron.selectCellAtIndex(2, { exitEditMode: true });
			await app.code.driver.page.keyboard.press('Enter');
			await notebooksPositron.expectCellIndexToBeSelected(2, {
				isSelected: true,
				inEditMode: true
			});

			// Verify we can type into the editor after pressing Enter
			await app.code.driver.page.keyboard.type('# test');
			await notebooksPositron.expectCellContentAtIndexToContain(2, /^# Cell 2# test/);
		});

		await test.step('Test 3: Shift+Enter on last cell creates new cell and enters edit mode', async () => {
			// Select last cell (index 4)
			await notebooksPositron.selectCellAtIndex(4);

			// Get initial cell count
			const initialCount = await notebooksPositron.getCellCount();
			expect(initialCount).toBe(5);

			// Press Shift+Enter to add a new cell below
			await app.code.driver.page.keyboard.press('Shift+Enter');

			// Verify new cell was added
			const newCount = await notebooksPositron.getCellCount();
			expect(newCount).toBe(6);

			// Verify the NEW cell (index 5) is now in edit mode with focus
			await notebooksPositron.expectCellIndexToBeSelected(5, { inEditMode: true });

			// Verify we can type immediately in the new cell
			await app.code.driver.page.keyboard.type('new cell content');
			await notebooksPositron.expectCellContentAtIndexToContain(5, 'new cell content');
		});
	});
});
