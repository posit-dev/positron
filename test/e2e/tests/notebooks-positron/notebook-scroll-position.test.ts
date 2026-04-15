/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';
import { PositronNotebooks } from '../../pages/notebooksPositron';

// Use the pokemon notebook because it has mixed markdown and code cells,
// which have different rendering times that could affect scroll restoration.
const NOTEBOOK_FILE = 'pokemon.ipynb';
const NOTEBOOK_PATH = path.join('workspaces', 'pokemon', NOTEBOOK_FILE);

/**
 * The scroll restoration code anchors to the topmost partially-visible cell
 * and preserves its offset from the viewport top. This helper captures that
 * anchor position so the test can verify it's restored.
 */
async function getAnchorCellPosition(notebooksPositron: PositronNotebooks) {
	const containerBox = await notebooksPositron.cellsContainer.boundingBox();
	expect(containerBox).not.toBeNull();
	const viewportTop = containerBox!.y;

	const cellCount = await notebooksPositron.cell.count();
	for (let i = 0; i < cellCount; i++) {
		const cellBox = await notebooksPositron.cell.nth(i).boundingBox();
		if (!cellBox) { continue; }
		// First cell whose bottom edge is below the viewport top
		if (cellBox.y + cellBox.height > viewportTop) {
			return { cellIndex: i, offsetFromViewportTop: cellBox.y - viewportTop };
		}
	}
	throw new Error('No anchor cell found in viewport');
}

/**
 * Asserts that the anchor cell's offset from the viewport top is restored
 * within tolerance. We check the cell's viewport-relative position rather
 * than absolute scrollTop because the anchor-based restoration preserves
 * the anchor cell's viewport position, and cumulative cell heights may
 * differ across platforms (e.g. different font metrics on Linux CI vs
 * macOS) or after a full reload.
 */
async function expectAnchorPositionRestored(
	notebooksPositron: PositronNotebooks,
	expectedIndex: number,
	expectedOffset: number,
) {
	await expect.poll(async () => {
		const containerBox = await notebooksPositron.cellsContainer.boundingBox();
		const cellBox = await notebooksPositron.cell.nth(expectedIndex).boundingBox();
		if (!containerBox || !cellBox) { return Infinity; }
		const currentOffset = cellBox.y - containerBox.y;
		return Math.abs(currentOffset - expectedOffset);
	}, { timeout: 5000 }).toBeLessThanOrEqual(1);
}

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

		// Capture the anchor cell's position relative to the viewport
		const { cellIndex, offsetFromViewportTop } = await getAnchorCellPosition(notebooksPositron);

		// Open a new untitled file to background the notebook
		await editors.newUntitledFile();

		// Switch back to the notebook tab by clicking it directly.
		// We can't use editors.selectTab() here because it expects a Monaco
		// editor to receive focus, but the notebook is a custom editor.
		await app.code.driver.page.getByRole('tab', { name: NOTEBOOK_FILE }).click();
		await notebooksPositron.expectToBeVisible();

		// Verify the anchor cell is at the same offset from the viewport top.
		// The restore refines for up to 1.5s as cells render, so poll until stable.
		await expectAnchorPositionRestored(notebooksPositron, cellIndex, offsetFromViewportTop);
	});

	test('Scroll position is restored after window reload', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Open the notebook
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);

		// Scroll to a middle cell in the notebook
		const middleCellIndex = Math.floor(await notebooksPositron.cell.count() / 2);
		await notebooksPositron.cell.nth(middleCellIndex).scrollIntoViewIfNeeded();

		// Capture the anchor cell's position relative to the viewport
		const { cellIndex, offsetFromViewportTop } = await getAnchorCellPosition(notebooksPositron);

		// Reload the window
		await hotKeys.reloadWindow(true);

		// Wait for the notebook to be visible again after reload
		await notebooksPositron.expectToBeVisible();

		// Verify the anchor cell is at the same offset from the viewport top.
		// The restore refines for up to 1.5s as cells render, so poll until stable.
		await expectAnchorPositionRestored(notebooksPositron, cellIndex, offsetFromViewportTop);
	});
});
