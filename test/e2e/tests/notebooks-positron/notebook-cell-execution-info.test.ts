/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Execution Footer', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.afterEach(async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.expectNoActiveSpinners();
	});

	test('Cell Execution Footer - Basic Functionality', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Test Setup: Create notebook and select kernel', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1); // Important for CI stability
			await notebooksPositron.kernel.select('Python');
		});

		// ========================================
		// Cell 0: Footer display with successful execution
		// ========================================
		await test.step('Cell 0 - Successful execution info display', async () => {
			// Verify footer shows success status
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });

			await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
			await notebooksPositron.expectFooterToContain(0, {
				duration: /\d+(ms|s)/,
				status: 'Cell execution succeeded'
			}, 30000);
		});

		// ========================================
		// Cell 1: Failed execution state display
		// ========================================
		await test.step('Cell 1 - Failed execution info display', async () => {
			// Verify footer shows failed status
			await notebooksPositron.addCodeToCell(1, 'raise Exception("test error")', {
				run: true,
			});
			await notebooksPositron.expectExecutionOrder([{ index: 1, order: 2 }]);
			await notebooksPositron.expectFooterToContain(1, {
				duration: /\d+(ms|s)/,
				status: 'Cell execution failed'
			});
		});

		// ========================================
		// Cell 2: Running execution state display
		// ========================================
		await test.step('Cell 2 - Running execution info display', async () => {
			// Verify footer shows running status while cell is executing
			await notebooksPositron.addCodeToCell(2, 'import time; time.sleep(3)', { run: true });
			await notebooksPositron.expectSpinnerAtIndex(2);
			await notebooksPositron.expectExecutionStatusToBe(2, 'running');
			await notebooksPositron.expectFooterToContain(2, {
				status: 'Cell is executing'
			});

			// Wait for execution to complete
			await notebooksPositron.expectSpinnerAtIndex(2, false);
		});

		// ========================================
		// Cell 3: Relative time display
		// ========================================
		await test.step('Cell 3 - Relative time display', async () => {
			await notebooksPositron.addCodeToCell(3, 'print("relative time test")', { run: true });
			await notebooksPositron.expectFooterToContain(3, {
				completed: /Just now|seconds ago/,
			});
		});

		// ========================================
		// Cell 4: Footer visibility based on cell state
		// ========================================
		await test.step('Cell 4 - Footer visibility for never-run cell', async () => {
			// Add a new cell but don't run it
			await notebooksPositron.addCodeToCell(4, 'print("never run")', { run: false });

			// Footer should not be visible for cells that have never been run
			await notebooksPositron.expectFooterVisible(4, false);
		});
	});
});
