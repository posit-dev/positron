/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Output Resize', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Drag sash resizes scrollable cell output', async function ({ app, page, settings }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create notebook with scrollable output', async () => {
			// Enable output scrolling explicitly - the default differs in dev vs release builds.
			await settings.set({ 'notebook.output.scrolling': true });

			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Generate output that exceeds the scrollable area so the resize
			// sash appears.
			await notebooksPositron.addCodeToCell(0, 'for i in range(100): print(f"line {i}")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['line 0']);
		});

		const sash = notebooksPositron.cellOutputSash(0);

		await test.step('Resize sash is visible for scrollable output', async () => {
			await expect(sash).toBeVisible();
		});

		const initialHeight = await notebooksPositron.getCellOutputHeight(0);

		await test.step('Dragging the sash changes the output height', async () => {
			const dragDistance = 150;
			await notebooksPositron.dragCellOutputSash(0, dragDistance);
			await notebooksPositron.expectCellOutputHeight(0, initialHeight + dragDistance);
		});

		await test.step('Double-clicking the sash resets to default height', async () => {
			await sash.click({ clickCount: 2 });
			await notebooksPositron.expectCellOutputHeight(0, initialHeight);
		});

		await test.step('Sash is hidden when output is collapsed', async () => {
			await notebooksPositron.outputCollapseToggle(0).scrollIntoViewIfNeeded();
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(sash).toBeHidden();

			// Expand again
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(sash).toBeVisible();
		});

		await test.step('Re-running cell resets height', async () => {
			await notebooksPositron.dragCellOutputSash(0, 100);
			await notebooksPositron.runCodeAtIndex(0);
			await notebooksPositron.expectCellOutputHeight(0, initialHeight);
		});
	});
});
