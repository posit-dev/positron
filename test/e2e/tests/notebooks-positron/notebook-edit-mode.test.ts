/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook Edit Mode', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});


	test('Clicking/dbl clicking into cell focuses editor and enters into edit mode', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });

		// Code cell: Can successfully enter edit mode by single clicking and typing
		await notebooksPositron.selectCellAtIndex(0);
		await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: true, inEditMode: true });
		await keyboard.type('cell editor good');
		await notebooksPositron.expectCellContentAtIndexToContain(0, 'cell editor good');

		// Markdown cell: Can successfully enter edit mode by double clicking and typing
		await notebooksPositron.selectCellAtIndex(2, { editMode: true });
		await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true, inEditMode: true });
		await keyboard.type('markdown editor good');
		await notebooksPositron.expectCellContentAtIndexToContain(2, 'markdown editor good');
	});


	test('Enter key on selected cell enters edit mode and doesn\'t add new lines', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create a new notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });

		// Code cell: Press Enter to enter edit mode and type
		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await keyboard.press('Enter');
		await notebooksPositron.expectCellIndexToBeSelected(0, {
			isSelected: true,
			inEditMode: true
		});
		await keyboard.type('code enter key');
		await notebooksPositron.expectCellContentAtIndexToContain(0, 'code enter key');

		// Markdown cell: Press Enter to enter edit mode and type
		await notebooksPositron.selectCellAtIndex(2);
		await keyboard.press('Enter');
		await notebooksPositron.expectCellIndexToBeSelected(2, {
			isSelected: true,
			inEditMode: true
		});
		await keyboard.type('markdown enter key');
		await notebooksPositron.expectCellContentAtIndexToContain(2, 'markdown enter key');

	});

	test('Shift+Enter on last cell creates new cell and enters edit mode', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.page.keyboard;

		// Create a new notebook with 3 cells
		await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });

		// Code cell: Verify pressing Shift+Enter adds a new cell below
		await notebooksPositron.selectCellAtIndex(2);
		await notebooksPositron.expectCellCountToBe(3);
		await keyboard.press('Shift+Enter');
		await notebooksPositron.expectCellCountToBe(4);

		// Verify the NEW cell (index 3) is now in edit mode with focus
		await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: true });

		// Verify we can type immediately in the new cell
		await keyboard.type('new cell content');
		await notebooksPositron.expectCellContentAtIndexToContain(3, 'new cell content');
	});
});
