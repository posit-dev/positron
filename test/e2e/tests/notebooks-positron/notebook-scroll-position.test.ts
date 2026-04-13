/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

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
		await app.code.driver.page.getByRole('tab', { name: NOTEBOOK_FILE }).click();
		await notebooksPositron.expectToBeVisible();

		// Verify the scroll position is restored.
		// The anchor-based restore refines for up to 1.5s as cells render,
		// so poll until stable.
		await expect.poll(async () => {
			const scrollTop = await notebooksPositron.getScrollTop();
			return Math.abs(scrollTop - scrollTopBefore);
		}, { timeout: 5000 }).toBeLessThanOrEqual(1);
	});

	test('Scroll position is restored after window reload', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Open the notebook
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);

		// Scroll to a middle cell in the notebook
		const middleCellIndex = Math.floor(await notebooksPositron.cell.count() / 2);
		await notebooksPositron.cell.nth(middleCellIndex).scrollIntoViewIfNeeded();

		// Capture the scroll position
		const scrollTopBefore = await notebooksPositron.getScrollTop();
		expect(scrollTopBefore).toBeGreaterThan(0);

		// Reload the window
		await hotKeys.reloadWindow(true);

		// Wait for the notebook to be visible again after reload
		await notebooksPositron.expectToBeVisible();

		// Verify the scroll position is restored.
		// The anchor-based restore refines for up to 1.5s as cells render,
		// so poll until stable.
		await expect.poll(async () => {
			const scrollTop = await notebooksPositron.getScrollTop();
			return Math.abs(scrollTop - scrollTopBefore);
		}, { timeout: 5000 }).toBeLessThanOrEqual(1);
	});
});
