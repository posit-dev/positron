/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Execution Tooltip', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		if (process.env.CI) {
			test.skip();
		}
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.moveMouseAway();
		await notebooksPositron.expectNoActiveSpinners();

		await hotKeys.closeAllEditors();
	});

	test('Cell Execution Tooltip - Basic Functionality', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Test Setup: Create notebook and select kernel', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1); // Important for CI stability
			await notebooksPositron.selectAndWaitForKernel('Python');
		});

		// ========================================
		// Cell 0: Basic popup display with successful execution
		// ========================================
		await test.step('Cell 0 - Successful execution info display', async () => {
			// Verify popup shows success status
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
			await notebooksPositron.expectToolTipToContain({
				order: 1,
				duration: /\d+(ms|s)/,
				status: 'Success'
			}, 30000);

			// Verify auto-close behavior
			await notebooksPositron.moveMouseAway();
			await notebooksPositron.expectToolTipVisible(false);
		});

		// ========================================
		// Cell 1: Failed execution state display
		// ========================================
		await test.step('Cell 1 - Failed execution info display', async () => {
			// Verify popup shows failed status
			await notebooksPositron.addCodeToCell(1, 'raise Exception("test error")', {
				run: true,
			});
			await notebooksPositron.expectToolTipToContain({
				order: 2,
				duration: /\d+(ms|s)/,
				status: 'Failed'
			});

			// Verify auto-close behavior
			await notebooksPositron.moveMouseAway();
			await notebooksPositron.expectToolTipVisible(false);
		});

		// ========================================
		// Cell 2: Running execution state display
		// ========================================
		await test.step('Cell 2 - Running execution info display', async () => {
			// Verify popup shows running status while cell is executing
			await notebooksPositron.addCodeToCell(2, 'import time; time.sleep(3)', { run: true });
			await notebooksPositron.expectSpinnerAtIndex(2);
			await notebooksPositron.expectExecutionStatusToBe(2, 'running');
			await notebooksPositron.expectToolTipToContain({
				status: 'Currently running...'
			});

			// Verify auto-close behavior
			await notebooksPositron.moveMouseAway();
			await notebooksPositron.expectSpinnerAtIndex(2, false);
		});

		// ========================================
		// Cell 3: Relative time display
		// ========================================
		await test.step('Cell 3 - Relative time display', async () => {
			await notebooksPositron.addCodeToCell(3, 'print("relative time test")', { run: true });
			await notebooksPositron.expectToolTipToContain({
				completed: /Just now|seconds ago/,
			});

			await notebooksPositron.moveMouseAway();
		});

		// ========================================
		// Cell 4: Hover timing and interaction
		// ========================================
		await test.step('Cell 4 - Hover timing and interaction', async () => {
			await notebooksPositron.addCodeToCell(4, 'print("hover test")', { run: true });

			// Test popup closes when mouse moves away
			await notebooksPositron.moveMouseAway();
			await notebooksPositron.expectToolTipVisible(false);

			// Test that hovering again after closing still works
			await notebooksPositron.runCellButtonAtIndex(4).hover();
			await notebooksPositron.expectToolTipVisible(true);
		});
	});
});
