/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: ipywidgets Slider', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeEach(async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await test.step('Setup: Create new notebook and select Python kernel', async () => {
			await notebooks.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
		});
	});

	test('Verify ipywidgets interact slider works', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Execute cell with ipywidgets interact code', async () => {
			const interactCode = `import ipywidgets as ipw
def f(x):
	print(x * x)

ipw.interact(f, x=(0, 100))`;

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		await test.step('Verify slider widget renders', async () => {
			const cellOutput = notebooksPositron.cellOutput(0);
			await expect(cellOutput).toBeVisible();

			// Wait for the widget to appear
			const widget = cellOutput.locator('.jupyter-widgets');
			await expect(widget).toBeVisible({ timeout: 10000 });

			// Verify slider is present
			const slider = widget.locator('input[type="range"]');
			await expect(slider).toBeVisible();

			// Verify label is present
			const label = widget.locator('label').filter({ hasText: 'x' });
			await expect(label).toBeVisible();
		});

		await test.step('Verify slider interaction updates output', async () => {
			const cellOutput = notebooksPositron.cellOutput(0);
			const widget = cellOutput.locator('.jupyter-widgets');
			const slider = widget.locator('input[type="range"]');

			// Change slider value to 10 using JavaScript
			await slider.evaluate((element: HTMLInputElement) => {
				element.value = '10';
				element.dispatchEvent(new Event('input', { bubbles: true }));
				element.dispatchEvent(new Event('change', { bubbles: true }));
			});

			// Wait for output to update
			await app.code.driver.page.waitForTimeout(500);

			// Verify output shows 10 * 10 = 100
			const outputArea = cellOutput.locator('.jp-OutputArea-output, .widget-output');
			await expect(outputArea.getByText('100')).toBeVisible({ timeout: 5000 });
		});
	});
});
