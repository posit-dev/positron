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

	test('Drag handle resizes scrollable cell output', async function ({ app, page, settings }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook with scrollable output', async () => {
			// Enable output scrolling explicitly -- the default depends on
			// product.quality and may be false in local dev builds.
			await settings.set({ 'notebook.output.scrolling': true });

			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Generate output that exceeds the scrollable area so the resize
			// handle appears.
			await notebooksPositron.addCodeToCell(0, 'for i in range(100): print(f"line {i}")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['line 0']);
		});

		const cellOutput = notebooksPositron.cellOutput(0);
		const splitter = cellOutput.locator('.horizontal-splitter');
		const resizeHandle = splitter.locator('.sizer');
		const outputInner = cellOutput.locator('.positron-notebook-code-cell-outputs-inner');

		await test.step('Resize handle is visible for scrollable output', async () => {
			await expect(splitter).toBeVisible({ timeout: 10000 });
		});

		await test.step('Dragging the handle changes the output height', async () => {
			const initialBox = await outputInner.boundingBox();
			expect(initialBox).toBeTruthy();
			const initialHeight = initialBox!.height;

			// Drag the resize handle downward to grow the output area.
			// The HorizontalSplitter uses setPointerCapture on document.body,
			// so we dispatch native PointerEvent objects to ensure capture
			// and event routing work correctly.
			const handleBox = await resizeHandle.boundingBox();
			expect(handleBox).toBeTruthy();
			const startX = handleBox!.x + handleBox!.width / 2;
			const startY = handleBox!.y + handleBox!.height / 2;
			const dragDistance = 150;

			await resizeHandle.evaluate((el, { startX, startY, dragDistance }) => {
				const body = document.body;

				el.dispatchEvent(new PointerEvent('pointerdown', {
					clientX: startX, clientY: startY,
					pointerId: 1, pointerType: 'mouse',
					buttons: 1, bubbles: true, cancelable: true,
				}));

				for (let i = 1; i <= 5; i++) {
					body.dispatchEvent(new PointerEvent('pointermove', {
						clientX: startX,
						clientY: startY + (dragDistance * i) / 5,
						pointerId: 1, pointerType: 'mouse',
						buttons: 1, bubbles: true, cancelable: true,
					}));
				}

				// Include final position -- the splitter calls pointerMoveHandler
				// with this event for one last update before cleanup.
				body.dispatchEvent(new PointerEvent('lostpointercapture', {
					clientX: startX,
					clientY: startY + dragDistance,
					pointerId: 1, pointerType: 'mouse',
					bubbles: true,
				}));
			}, { startX, startY, dragDistance });

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

			// Dispatch dblclick directly to avoid triggering pointerdown
			// drag handlers that would re-set the height override.
			await resizeHandle.dispatchEvent('dblclick', {});

			// After reset, the height-override class should be removed
			await expect(outputInner).not.toHaveClass(/height-override/, { timeout: 5000 });
		});

		await test.step('Resize handle is hidden when output is collapsed', async () => {
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(notebooksPositron.outputCollapsedLabel(0)).toBeVisible();
			await expect(splitter).toBeHidden();

			// Expand again
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(splitter).toBeVisible();
		});

		await test.step('Re-running cell resets the resize override', async () => {
			// Resize first
			const handleBox = await resizeHandle.boundingBox();
			expect(handleBox).toBeTruthy();
			const startX = handleBox!.x + handleBox!.width / 2;
			const startY = handleBox!.y + handleBox!.height / 2;

			await resizeHandle.evaluate((el, { startX, startY }) => {
				const body = document.body;
				el.dispatchEvent(new PointerEvent('pointerdown', {
					clientX: startX, clientY: startY,
					pointerId: 1, pointerType: 'mouse',
					buttons: 1, bubbles: true, cancelable: true,
				}));
				body.dispatchEvent(new PointerEvent('pointermove', {
					clientX: startX, clientY: startY + 100,
					pointerId: 1, pointerType: 'mouse',
					buttons: 1, bubbles: true, cancelable: true,
				}));
				body.dispatchEvent(new PointerEvent('lostpointercapture', {
					clientX: startX, clientY: startY + 100,
					pointerId: 1, pointerType: 'mouse', bubbles: true,
				}));
			}, { startX, startY });

			await expect(outputInner).toHaveClass(/height-override/);

			// Re-run the cell - should reset the height override
			await notebooksPositron.runCodeAtIndex(0);
			await expect(outputInner).not.toHaveClass(/height-override/, { timeout: 15000 });
		});
	});
});
