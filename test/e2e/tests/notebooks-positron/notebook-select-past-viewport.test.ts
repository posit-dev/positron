/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { Application } from '../../infra';

test.use({
	suiteId: __filename
});

/**
 * Extending a selection past the notebook viewport should scroll the notebook to
 * follow the selection, both with the mouse (drag past the container edge) and
 * with the keyboard (Shift+Down past the fold).
 */
test.describe('Positron Notebooks: Select Past Viewport', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ hotKeys }) {
		await hotKeys.minimizeBottomPanel();
	});

	/** Create a notebook whose first cell is taller than the viewport, cursor on line 1. */
	async function setupTallCell(app: Application) {
		const { notebooksPositron } = app.workbench;
		const lines = Array.from({ length: 60 }, (_, i) => `line_${i} = ${i}`).join('\n');
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, lines, { fast: true });

		// Typing may have scrolled the container; reset to the top and place the
		// cursor on the first line so the selection starts above the fold.
		await notebooksPositron.cellsContainer.evaluate(el => { el.scrollTop = 0; });
		const firstLine = notebooksPositron.cell.nth(0).locator('.view-line').first();
		await firstLine.click();
		return notebooksPositron;
	}

	test('Keyboard selection past the viewport scrolls the notebook (#13240)', async function ({ app }) {
		const notebooksPositron = await setupTallCell(app);
		expect(await notebooksPositron.getScrollTop()).toBe(0);

		// Extend the selection line by line well past the visible area.
		for (let i = 0; i < 45; i++) {
			await app.code.driver.currentPage.keyboard.press('Shift+ArrowDown', { delay: 10 });
		}

		// The notebook scrolled down to keep the selection cursor visible.
		await expect.poll(() => notebooksPositron.getScrollTop(), { timeout: 5000 }).toBeGreaterThan(0);
	});

	test('Drag selection past the viewport scrolls the notebook and extends the selection (#13240)', async function ({ app }) {
		const notebooksPositron = await setupTallCell(app);
		const page = app.code.driver.currentPage;

		// Start a drag on the first line of the cell...
		const firstLineBox = await notebooksPositron.cell.nth(0).locator('.view-line').first().boundingBox();
		const containerBox = await notebooksPositron.cellsContainer.boundingBox();
		expect(firstLineBox).not.toBeNull();
		expect(containerBox).not.toBeNull();
		await page.mouse.move(firstLineBox!.x + 5, firstLineBox!.y + firstLineBox!.height / 2);
		await page.mouse.down();

		// ...and move the pointer below the container's bottom edge, holding it there.
		await page.mouse.move(
			firstLineBox!.x + 5,
			containerBox!.y + containerBox!.height + 50,
			{ steps: 10 }
		);

		// While the button is held outside the viewport, the notebook auto-scrolls...
		await expect.poll(() => notebooksPositron.getScrollTop(), { timeout: 5000 }).toBeGreaterThan(0);
		const midDragScrollTop = await notebooksPositron.getScrollTop();
		await expect.poll(() => notebooksPositron.getScrollTop(), { timeout: 5000 }).toBeGreaterThan(midDragScrollTop);

		await page.mouse.up();

		// ...and the selection followed: many lines are now selected.
		const selectedLines = notebooksPositron.cell.nth(0).locator('.view-overlays .selected-text');
		expect(await selectedLines.count()).toBeGreaterThan(5);
	});
});
