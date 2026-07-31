/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Output', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Collapse, expand, and clear output', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Open a notebook and run the first cell', async () => {
			// Setup the notebook
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');

			// Run cell to generate output
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Toggle is hidden when cell is not hovered or selected', async () => {
			// Add a second cell so we can deselect the first
			await notebooksPositron.addCell('code');
			await notebooksPositron.selectCellAtIndex(1);
			// Move hover away from the first cell
			await notebooksPositron.cell.nth(1).hover();
			await expect(notebooksPositron.outputCollapseToggle(0)).not.toBeVisible();
		});

		await test.step('Toggle becomes visible when cell is hovered', async () => {
			await notebooksPositron.cell.nth(0).hover();
			await expect(notebooksPositron.outputCollapseToggle(0)).toBeVisible();
		});

		await test.step('Toggle is visible when cell is selected but not hovered', async () => {
			await notebooksPositron.selectCellAtIndex(0);
			// Move hover away from the first cell
			await notebooksPositron.cell.nth(1).hover();
			await expect(notebooksPositron.outputCollapseToggle(0)).toBeVisible();
		});

		await test.step('Clicking the collapse toggle hides the output', async () => {
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(notebooksPositron.outputCollapsedLabel(0)).toBeVisible();
			await expect(notebooksPositron.cellOutput(0).getByText('hello world')).toBeHidden();
		});

		await test.step('Clicking the expand toggle shows the output again', async () => {
			await notebooksPositron.outputCollapseToggle(0).click();
			await expect(notebooksPositron.outputCollapsedLabel(0)).toBeHidden();
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Clear output removes the output', async () => {
			await notebooksPositron.triggerCellOutputAction(0, 'Clear Output');
			await expect(notebooksPositron.cellOutput(0)).toBeEmpty();
		});
	});

	test('%%html with inline script renders in a webview and the notebook survives', async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Open a notebook and select the Python kernel', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectToBeVisible();
			await notebooksPositron.kernel.select('Python');
		});

		await test.step('Run a %%html cell whose script manipulates the DOM', async () => {
			const htmlWithScript = [
				'%%html',
				'<div id="output"></div>',
				'<script>',
				`document.getElementById('output').innerHTML = "<p>Hello from JavaScript!</p>";`,
				'</script>',
			].join('\n');
			await notebooksPositron.addCodeToCell(0, htmlWithScript, { fast: true, run: true, waitForSpinner: true });
		});

		await test.step('Script executes inside a sandboxed webview', async () => {
			await expect(notebooksPositron.frameLocator.getByText('Hello from JavaScript!')).toBeVisible({ timeout: 30000 });
		});

		await test.step('Notebook still works: add and run another cell', async () => {
			await notebooksPositron.addCodeToCell(1, 'print("still alive")', { run: true, waitForSpinner: true });
			await notebooksPositron.expectCellCountToBe(2);
			await notebooksPositron.expectOutputAtIndex(1, ['still alive']);
		});
	});

	test('IPython.display.Image wider than the cell scales down to fit', async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Open a notebook and select the Python kernel', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectToBeVisible();
			await notebooksPositron.kernel.select('Python');
		});

		await test.step('Display a 3000px-wide PNG built with the stdlib', async () => {
			const wideImageCode = [
				'import zlib, struct',
				'from IPython.display import Image, display',
				'w, h = 3000, 50',
				`chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))`,
				`ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)`,
				String.raw`raw = (b'\x00' + b'\x30\x60\x90' * w) * h`,
				String.raw`png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')`,
				'display(Image(data=png))',
			].join('\n');
			await notebooksPositron.addCodeToCell(0, wideImageCode, { fast: true, run: true, waitForSpinner: true });
		});

		const image = notebooksPositron.cellOutput(0).locator('img');

		await test.step('Image renders and decodes at its natural size', async () => {
			await expect(image).toBeVisible({ timeout: 30000 });
			await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(3000);
		});

		await test.step('Rendered image is constrained to the output width', async () => {
			const imageBox = await image.boundingBox();
			const outputBox = await notebooksPositron.cellOutput(0).boundingBox();
			expect(imageBox).not.toBeNull();
			expect(outputBox).not.toBeNull();
			expect(imageBox!.width, 'image must not overflow its output container').toBeLessThanOrEqual(outputBox!.width);
			expect(imageBox!.width, 'a 3000px image must be scaled down, not shown at natural size').toBeLessThan(3000);
		});
	});
});
