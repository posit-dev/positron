/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Cell Toolbar', {
	tag: [tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Only one cell toolbar is visible after mouse leaves previous toolbar', async function ({ python, app, page, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file with multiple cells
		await openFile(join('workspaces', 'quarto_inline_output', 'copy_output_test.qmd'));
		await editors.waitForActiveTab('copy_output_test.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Navigate to first cell (line 11 is inside the first python cell)
		await inlineQuarto.gotoLine(11);

		await test.step('Wait for first cell toolbar', async () => {
			await expect(inlineQuarto.visibleCellToolbar).toHaveCount(1, { timeout: 10000 });
		});

		await test.step('Simulate mouse hovering over first toolbar', async () => {
			// Dispatch mouseenter on the first toolbar to simulate the
			// mouse hovering over it. This sets _isMouseOverToolbar = true.
			await page.locator('.quarto-cell-toolbar').first().dispatchEvent('mouseenter');
			await page.waitForTimeout(200);
		});

		await test.step('Navigate to second cell', async () => {
			await inlineQuarto.gotoLine(21);
			await page.waitForTimeout(300);
		});

		await test.step('Simulate mouse leaving first toolbar', async () => {
			// Dispatch mouseleave on the first toolbar. With the bug,
			// the toolbar stays visible because _isCursorInCell was
			// never reset to false when _showToolbarExclusively skipped
			// the toolbar due to isMouseOverToolbar being true.
			await page.locator('.quarto-cell-toolbar').first().dispatchEvent('mouseleave');
			await page.waitForTimeout(500);
		});

		// There should be exactly one visible toolbar (the second cell's).
		await inlineQuarto.expectSingleVisibleToolbar();
	});
});
