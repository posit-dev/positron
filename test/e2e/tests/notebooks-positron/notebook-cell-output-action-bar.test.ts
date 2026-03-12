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

	test.afterEach(async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.expectNoActiveSpinners();
	});

	test('Output action bar appears on hover and has correct structure', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook and run a cell', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello']);
		});

		await test.step('Action bar appears on hover over output section', async () => {
			await notebooksPositron.hoverOutputSection(0);
			await notebooksPositron.expectOutputActionBarToBeVisible(0);
		});

		await test.step('Action bar has correct ARIA attributes', async () => {
			const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(0);
			const actionBar = cell.locator('.cell-output-action-bar');
			await expect(actionBar).toHaveRole('toolbar');
			await expect(actionBar).toHaveAttribute('aria-label', 'Cell output actions');
		});
	});

	test('Collapse and expand output using action bar', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook and run a cell', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Collapse output hides the output content', async () => {
			await notebooksPositron.collapseOutput(0);
			await notebooksPositron.expectOutputToBeCollapsed(0);
		});

		await test.step('Expand output shows the output content again', async () => {
			await notebooksPositron.expandOutput(0);
			await notebooksPositron.expectOutputToBeExpanded(0);
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});
	});

	test('Clear output using action bar', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook and run a cell', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("to be cleared")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['to be cleared']);
		});

		await test.step('Clear output removes the output', async () => {
			await notebooksPositron.clearOutputWithActionBar(0);

			// After clearing, the output section should not contain the previous text
			const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(0);
			const output = cell.getByTestId('cell-output');
			await expect(output.getByText('to be cleared')).toBeHidden({ timeout: 10000 });
		});

		await test.step('Action bar is not visible after output is cleared', async () => {
			// With no outputs, the action bar should not render
			await notebooksPositron.expectOutputActionBarToBeHidden(0);
		});
	});

	test('Output action bar works across multiple cells', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook with two code cells', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Add code to cell 0 and run
			await notebooksPositron.addCodeToCell(0, 'print("output A")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['output A']);

			// Add second cell, add code and run
			await notebooksPositron.addCodeToCell(1, 'print("output B")', { run: true });
			await notebooksPositron.expectOutputAtIndex(1, ['output B']);
		});

		await test.step('Collapse output on cell 0 does not affect cell 1', async () => {
			await notebooksPositron.collapseOutput(0);
			await notebooksPositron.expectOutputToBeCollapsed(0);
			await notebooksPositron.expectOutputToBeExpanded(1);
			await notebooksPositron.expectOutputAtIndex(1, ['output B']);
		});

		await test.step('Clear output on cell 1 does not affect cell 0', async () => {
			await notebooksPositron.clearOutputWithActionBar(1);

			// Cell 0 should still be collapsed
			await notebooksPositron.expectOutputToBeCollapsed(0);

			// Cell 1 output should be cleared
			const cell1 = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(1);
			await expect(cell1.getByTestId('cell-output').getByText('output B')).toBeHidden({ timeout: 10000 });
		});

		await test.step('Expand cell 0 output restores it', async () => {
			await notebooksPositron.expandOutput(0);
			await notebooksPositron.expectOutputToBeExpanded(0);
			await notebooksPositron.expectOutputAtIndex(0, ['output A']);
		});
	});
});
