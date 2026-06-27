/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Run Selection in Cell', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/3804' }],
}, () => {

	test('Python - Runs only the highlighted selection, then the cursor line', async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.currentPage.keyboard;
		const runSelection = process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter';

		await test.step('Create a notebook with a two-line code cell', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			// Leaves focus in the cell editor with the cursor at the end of line 2.
			await notebooksPositron.addCodeToCell(0, 'print("first")\nprint("second")');
		});

		await test.step('Highlight the second line and run the selection', async () => {
			await keyboard.press('Home');
			await keyboard.press('Shift+End');
			await keyboard.press(runSelection);
		});

		await test.step('Verify only the selected line ran, with output on the cell', async () => {
			await notebooksPositron.expectOutputAtIndex(0, ['second']);
			await expect(notebooksPositron.cellOutput(0).getByText('first')).toHaveCount(0);
		});

		await test.step('Move the cursor to the first line with no selection and run again', async () => {
			await keyboard.press('Home');
			await keyboard.press('ArrowUp');
			await keyboard.press(runSelection);
		});

		await test.step('Verify the cursor line ran, replacing the previous output', async () => {
			await notebooksPositron.expectOutputAtIndex(0, ['first']);
			await expect(notebooksPositron.cellOutput(0).getByText('second')).toHaveCount(0);
		});
	});
});
