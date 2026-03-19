/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Output Action Bar', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Output action bar: collapse, expand, and clear output', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Open a notebook and run the first cell', async () => {
			// Setup the notebook
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Run cell to generate output
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Collapse output hides the output content', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Collapse Output');
			await expect(notebooksPositron.showHiddenOutputButton(0)).toBeVisible();
			await expect(notebooksPositron.cellOutput(0).getByText('hello world')).toBeHidden();
		});

		await test.step('Expand output shows the output content again', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Expand Output');
			await expect(notebooksPositron.showHiddenOutputButton(0)).toBeHidden();
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Clear output removes the output', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Clear Output');
			await expect(notebooksPositron.cellOutput(0)).toBeEmpty();
		});
	});
});
