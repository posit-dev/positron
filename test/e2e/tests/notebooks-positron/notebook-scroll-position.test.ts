/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

const NOTEBOOK_PATH = path.join('workspaces', 'bitmap-notebook', 'bitmap-notebook.ipynb');

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Scroll Position', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Scroll position is restored when switching tabs', async function ({ app }) {
		const { notebooksPositron, editors } = app.workbench;

		// Open the notebook and wait for it to render
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
		await notebooksPositron.expectToBeVisible();

		// Scroll to a middle cell in the notebook
		await notebooksPositron.cell.nth(10).scrollIntoViewIfNeeded();

		// Capture the scroll position
		const scrollTopBefore = await notebooksPositron.getScrollTop();
		expect(scrollTopBefore).toBeGreaterThan(0);

		// Open a new untitled file to background the notebook
		await editors.newUntitledFile();

		// Switch back to the notebook tab by clicking it directly.
		// We can't use editors.selectTab() here because it expects a Monaco
		// editor to receive focus, but the notebook is a custom editor.
		await app.code.driver.page.getByRole('tab', { name: 'bitmap-notebook.ipynb' }).click();
		await notebooksPositron.expectToBeVisible();

		// Verify the scroll position is restored
		const scrollTopAfter = await notebooksPositron.getScrollTop();
		expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThanOrEqual(1);
	});

	test('Scroll position is restored after window reload', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// Open the notebook and wait for it to render
		await notebooksPositron.openNotebook(NOTEBOOK_PATH);
		await notebooksPositron.expectToBeVisible();

		// Scroll to a middle cell in the notebook
		await notebooksPositron.cell.nth(10).scrollIntoViewIfNeeded();

		// Capture the scroll position
		const scrollTopBefore = await notebooksPositron.getScrollTop();
		expect(scrollTopBefore).toBeGreaterThan(0);

		// Reload the window
		await hotKeys.reloadWindow(true);

		// Wait for the notebook to be visible again after reload
		await notebooksPositron.expectToBeVisible();

		// Verify the scroll position is restored
		const scrollTopAfter = await notebooksPositron.getScrollTop();
		expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThanOrEqual(1);
	});
});
