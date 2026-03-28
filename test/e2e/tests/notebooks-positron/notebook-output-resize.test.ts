/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Output Resize Handle', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Drag handle resizes scrollable cell output', async function ({ app, page }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook with scrollable output', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Generate output that exceeds the scrollable area so the resize
			// handle appears (output scrolling is on by default).
			await notebooksPositron.addCodeToCell(0, 'for i in range(100): print(f"line {i}")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['line 0']);
		});

		const cellOutput = notebooksPositron.cellOutput(0);
		const resizeHandle = cellOutput.locator('.cell-output-resize-handle');
		const outputInner = cellOutput.locator('.positron-notebook-code-cell-outputs-inner');

		await test.step('Resize handle is visible for scrollable output', async () => {
			await expect(resizeHandle).toBeVisible({ timeout: 10000 });
			await expect(resizeHandle).toHaveCSS('cursor', 'ns-resize');
		});

		await test.step('Dragging the handle changes the output height', async () => {
			const initialBox = await outputInner.boundingBox();
			expect(initialBox).toBeTruthy();
			const initialHeight = initialBox!.height;

			// Drag the resize handle downward to grow the output area
			const handleBox = await resizeHandle.boundingBox();
			expect(handleBox).toBeTruthy();
			const startX = handleBox!.x + handleBox!.width / 2;
			const startY = handleBox!.y + handleBox!.height / 2;
			const dragDistance = 150;

			await page.mouse.move(startX, startY);
			await page.mouse.down();
			await page.mouse.move(startX, startY + dragDistance, { steps: 5 });
			await page.mouse.up();

			// The output container should now be taller
			await expect(async () => {
				const newBox = await outputInner.boundingBox();
				expect(newBox).toBeTruthy();
				expect(newBox!.height).toBeGreaterThan(initialHeight + 50);
			}).toPass({ timeout: 5000 });
		});

		await test.step('Double-clicking the handle resets to default height', async () => {
			// The output inner should have a height-override class after resizing
			await expect(outputInner).toHaveClass(/height-override/);

			await resizeHandle.dblclick();

			// After reset, the height-override class should be removed
			await expect(outputInner).not.toHaveClass(/height-override/, { timeout: 5000 });
		});

		await test.step('Resize handle is hidden when output is collapsed', async () => {
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(notebooksPositron.outputCollapsedLabel(0)).toBeVisible();
			await expect(resizeHandle).toBeHidden();

			// Expand again
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(resizeHandle).toBeVisible();
		});

		await test.step('Re-running cell resets the resize override', async () => {
			// Resize first
			const handleBox = await resizeHandle.boundingBox();
			expect(handleBox).toBeTruthy();
			const startX = handleBox!.x + handleBox!.width / 2;
			const startY = handleBox!.y + handleBox!.height / 2;

			await page.mouse.move(startX, startY);
			await page.mouse.down();
			await page.mouse.move(startX, startY + 100, { steps: 5 });
			await page.mouse.up();

			await expect(outputInner).toHaveClass(/height-override/);

			// Re-run the cell - should reset the height override
			await notebooksPositron.runCodeAtIndex(0);
			await expect(outputInner).not.toHaveClass(/height-override/, { timeout: 15000 });
		});
	});

	test('Find widget sash resizes the widget', async function ({ app, page }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook and open find widget', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, '# hello world');

			await notebooksPositron.search('hello', { enterKey: false });
		});

		const findWidget = page.locator('.positron-find-widget');
		const sash = findWidget.locator('.find-widget-sash');

		await test.step('Find widget sash is present', async () => {
			await expect(findWidget).toBeVisible({ timeout: 10000 });
			await expect(sash).toBeAttached();
			await expect(sash).toHaveCSS('cursor', 'ew-resize');
		});

		await test.step('Dragging the sash changes the widget width', async () => {
			const initialBox = await findWidget.boundingBox();
			expect(initialBox).toBeTruthy();
			const initialWidth = initialBox!.width;

			// The sash is on the left edge; drag left to widen
			const sashBox = await sash.boundingBox();
			expect(sashBox).toBeTruthy();
			const startX = sashBox!.x + sashBox!.width / 2;
			const startY = sashBox!.y + sashBox!.height / 2;
			const dragDistance = -200; // drag left to grow

			await page.mouse.move(startX, startY);
			await page.mouse.down();
			await page.mouse.move(startX + dragDistance, startY, { steps: 5 });
			await page.mouse.up();

			await expect(async () => {
				const newBox = await findWidget.boundingBox();
				expect(newBox).toBeTruthy();
				expect(newBox!.width).toBeGreaterThan(initialWidth + 50);
			}).toPass({ timeout: 5000 });
		});
	});
});
