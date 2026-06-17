/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

// Use the pokemon notebook because it has mixed markdown and code cells,
// which have different rendering times that could affect scroll restoration.
const NOTEBOOK_FILE = 'pokemon.ipynb';
const NOTEBOOK_PATH = path.join('workspaces', 'pokemon', NOTEBOOK_FILE);

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Scroll Position', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Scroll position is restored when switching tabs', async function ({ app }) {
		const { notebooksPositron, editors } = app.workbench;

		// Open the notebook
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);

		// Scroll to a middle cell in the notebook
		const middleCellIndex = Math.floor(await notebooksPositron.cell.count() / 2);
		await notebooksPositron.cell.nth(middleCellIndex).scrollIntoViewIfNeeded();

		// Capture the scroll position
		const scrollTopBefore = await notebooksPositron.getScrollTop();
		expect(scrollTopBefore).toBeGreaterThan(0);

		// Open a new untitled file to background the notebook
		await editors.newUntitledFile();

		// Switch back to the notebook tab by clicking it directly.
		// We can't use editors.selectTab() here because it expects a Monaco
		// editor to receive focus, but the notebook is a custom editor.
		await app.code.driver.currentPage.getByRole('tab', { name: NOTEBOOK_FILE }).click();
		await notebooksPositron.expectToBeVisible();

		// Verify the scroll position is restored.
		await expect.poll(async () => {
			const scrollTop = await notebooksPositron.getScrollTop();
			return Math.abs(scrollTop - scrollTopBefore);
		}, { timeout: 5000 }).toBeLessThanOrEqual(1);
	});

	// skipping because reloadWindow is unreliable
	test.skip('Scroll position is restored after window reload', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Open the notebook
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);

		// Scroll to a middle cell in the notebook
		const middleCellIndex = Math.floor(await notebooksPositron.cell.count() / 2);
		await notebooksPositron.cell.nth(middleCellIndex).scrollIntoViewIfNeeded();

		// Capture the scroll anchor (first visible cell + offset within viewport).
		// Cells above can re-render with slightly different heights after reload,
		// shifting scrollTop without changing what the user sees -- so compare the
		// anchor that restoration actually preserves, not the raw scrollTop.
		const anchorBefore = await notebooksPositron.getScrollAnchor();
		expect(anchorBefore).not.toBeNull();

		// Reload the window
		await hotKeys.reloadWindow(true);

		// Wait for the notebook to be visible again after reload
		await notebooksPositron.expectToBeVisible();

		// Wait for cells to actually render -- expectToBeVisible() only waits for
		// the container, not its children. On slower CI envs the tab restore can
		// take longer than the scroll-comparison timeout below.
		await expect.poll(() => notebooksPositron.cell.count(), { timeout: 30000 }).toBeGreaterThan(0);

		// Verify the same cell is first-visible at the same offset.
		await expect.poll(async () => {
			const anchorAfter = await notebooksPositron.getScrollAnchor();
			if (!anchorAfter || anchorAfter.cellIndex !== anchorBefore!.cellIndex) {
				return Number.POSITIVE_INFINITY;
			}
			return Math.abs(anchorAfter.offsetFromTop - anchorBefore!.offsetFromTop);
		}, { timeout: 5000 }).toBeLessThanOrEqual(50);
	});
});
