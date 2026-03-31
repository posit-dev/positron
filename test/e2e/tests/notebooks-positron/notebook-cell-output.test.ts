/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Output', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Collapse, expand, and clear output', async function ({ app }) {
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

		await test.step('Toggle is hidden when cell is not hovered or selected', async () => {
			// Add a second cell so we can deselect the first
			await notebooksPositron.addCell('code');
			await notebooksPositron.selectCellAtIndex(1);
			// Move hover away from the first cell
			await notebooksPositron.cell.nth(1).hover();
			await expect(notebooksPositron.outputCollapseToggle(0)).not.toBeVisible();
		});

		await test.step('Toggle becomes visible when cell is hovered', async () => {
			await notebooksPositron.cell.nth(0).hover();
			await expect(notebooksPositron.outputCollapseToggle(0)).toBeVisible();
		});

		await test.step('Toggle is visible when cell is selected but not hovered', async () => {
			await notebooksPositron.selectCellAtIndex(0);
			// Move hover away from the first cell
			await notebooksPositron.cell.nth(1).hover();
			await expect(notebooksPositron.outputCollapseToggle(0)).toBeVisible();
		});

		await test.step('Clicking the collapse toggle hides the output', async () => {
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(notebooksPositron.outputCollapsedLabel(0)).toBeVisible();
			await expect(notebooksPositron.cellOutput(0).getByText('hello world')).toBeHidden();
		});

		await test.step('Clicking the expand toggle shows the output again', async () => {
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(notebooksPositron.outputCollapsedLabel(0)).toBeHidden();
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Clear output removes the output', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Clear Output');
			await expect(notebooksPositron.cellOutput(0)).toBeEmpty();
		});
	});

	test('Toggle long output truncation', async function ({ app, settings }) {
		const { notebooks, notebooksPositron } = app.workbench;

		// Disable output scrolling so truncation is active.
		// In non-stable builds (e.g. CI), scrolling defaults to true
		// (see notebook.contribution.ts NotebookSetting.outputScrolling)
		// which disables truncation entirely.
		await settings.set(
			{ 'notebook.output.scrolling': false },
		);

		await test.step('Setup: Open a notebook and generate long output', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Generate output that exceeds the default 30-line limit
			await notebooksPositron.addCodeToCell(0, 'for i in range(50): print(f"line {i}")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['line 0']);
		});

		const outputTruncationMessage = notebooksPositron.outputTruncationMessage(0);

		await test.step('Long output is truncated with a truncation message', async () => {
			await expect(outputTruncationMessage).toContainText('lines truncated');
		});

		await test.step('Show Full Output via action bar removes truncation', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Show Full Output');
			await expect(outputTruncationMessage).toBeHidden();
			// A line hidden during truncation should now be visible.
			// With 50 lines and a 30-line limit, lines 29-48 are truncated.
			await notebooksPositron.expectOutputAtIndex(0, ['line 35']);
		});

		await test.step('Truncate Output via action bar restores truncation', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Truncate Output');
			await expect(outputTruncationMessage).toBeVisible();
		});

		await test.step('Re-running the cell resets truncation state', async () => {
			// Currently showing full output (no truncation message).
			// Re-run the cell - this should reset the per-cell override
			// back to the global default (truncated).
			await notebooksPositron.runCodeAtIndex(0);

			await expect(outputTruncationMessage).toBeVisible();
		});
	});
});
