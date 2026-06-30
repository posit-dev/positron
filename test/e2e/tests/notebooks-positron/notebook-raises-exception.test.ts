/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Execution with raises-exception tag', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeEach(async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;
		await notebooks.createNewNotebook();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.kernel.select('Python');
	});

	test('Python - Execution stops at exception without raises-exception tag', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.addCodeToCell(0, 'print("Cell 1 executed")');
		await notebooksPositron.addCodeToCell(1, 'raise ValueError("This should stop execution")');
		await notebooksPositron.addCodeToCell(2, 'print("Cell 3 should not execute")');

		await notebooksPositron.runAllCells();

		// Cell 1 runs, cell 2 raises. Once the error renders, execution has stopped.
		await notebooksPositron.expectOutputAtIndex(0, ['Cell 1 executed']);
		await expect(
			notebooksPositron.cellOutput(1).getByText('ValueError: This should stop execution')
		).toBeVisible({ timeout: 15000 });

		// Cells 1 and 2 ran in order; cell 3 never ran (execution stopped at the
		// error), so it produced no output. runAllCells already waited for all
		// spinners to clear, so the run has fully settled by this point.
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
		]);
		await expect(notebooksPositron.cellOutput(2)).not.toContainText('Cell 3 should not execute');
	});

	test('Python - Execution continues after exception with raises-exception tag', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.addCodeToCell(0, 'print("Cell 1 executed")');
		await notebooksPositron.addCodeToCell(1, 'raise ValueError("Expected error - execution should continue")');
		await notebooksPositron.addCodeToCell(2, 'print("Cell 3 executed successfully!")');

		// Tag cell 2 so its error does not halt the run.
		await notebooksPositron.addCellTag(1, 'raises-exception');

		await notebooksPositron.runAllCells();

		// All three cells run despite cell 2 raising.
		await notebooksPositron.expectOutputAtIndex(0, ['Cell 1 executed']);
		await expect(
			notebooksPositron.cellOutput(1).getByText('ValueError: Expected error - execution should continue')
		).toBeVisible({ timeout: 15000 });
		await notebooksPositron.expectOutputAtIndex(2, ['Cell 3 executed successfully!']);
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
			{ index: 2, order: 3 },
		]);
	});
});
