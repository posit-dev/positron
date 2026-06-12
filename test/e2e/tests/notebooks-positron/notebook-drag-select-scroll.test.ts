/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Notebook Drag Select Past Viewport', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ hotKeys }) {
		await hotKeys.minimizeBottomPanel();
	});

	test('Tall cell editor is capped to viewport height and scrollable (#13240)', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create a notebook with a tall code cell (55 lines exceeds any viewport)
		const lines = Array.from({ length: 55 }, (_, i) => `line_${i} = ${i}`).join('\n');
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, lines, { fast: true });

		// The editor should be capped to the viewport height (not full content height)
		const cellsContainer = notebooksPositron.cellsContainer;
		const editorWidget = notebooksPositron.cell.nth(0).locator('.positron-cell-editor-monaco-widget');

		await expect(async () => {
			const containerHeight = await cellsContainer.evaluate(el => el.clientHeight);
			const editorHeight = await editorWidget.evaluate(el => el.getBoundingClientRect().height);

			// Editor must be shorter than or equal to container (it's capped)
			expect(editorHeight).toBeLessThanOrEqual(containerHeight);
			// Editor must be significantly smaller than its content (55 lines * ~18px = ~990px)
			expect(editorHeight).toBeLessThan(900);
		}).toPass({ timeout: 5000 });

		// The editor should have a visible scrollbar (proving it's internally scrollable)
		const scrollbar = editorWidget.locator('> .monaco-editor .scrollbar.vertical > .slider').first();
		await expect(scrollbar).toBeVisible();

		// The scrollbar slider should be smaller than the track (indicating scrollable content)
		const sliderHeight = await scrollbar.evaluate(el => parseFloat(el.style.height));
		const trackHeight = await editorWidget.locator('> .monaco-editor .scrollbar.vertical').first().evaluate(
			el => el.getBoundingClientRect().height
		);
		expect(sliderHeight).toBeLessThan(trackHeight);
	});

	test('Short cells are not capped and show all content without scrollbar', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Create a notebook with a short cell (3 lines)
		const lines = 'a = 1\nb = 2\nc = 3';
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, lines, { fast: true });

		// The editor should show all content without an internal scrollbar
		const editorWidget = notebooksPositron.cell.nth(0).locator('.positron-cell-editor-monaco-widget');
		const scrollbar = editorWidget.locator('> .monaco-editor .scrollbar.vertical.visible');
		await expect(scrollbar).toHaveCount(0);
	});
});
