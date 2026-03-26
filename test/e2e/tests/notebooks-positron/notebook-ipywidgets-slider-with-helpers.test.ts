/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { IpywidgetsHelpers } from './helpers/ipywidgets-helpers';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: ipywidgets Slider (Using Helpers)', {
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

	test('Verify ipywidgets slider with interact - comprehensive test', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Execute the interact code
		await test.step('Execute cell with ipywidgets interact code', async () => {
			const interactCode = `import ipywidgets as ipw

def f(x):
	print(x * x)

ipw.interact(f, x=(0, 100))`;

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		// Wait for widget to render
		const sliderWidget = await test.step('Wait for widget to render', async () => {
			const cellOutput = notebooksPositron.cellOutput(0);
			return await IpywidgetsHelpers.waitForWidget(cellOutput, '.jupyter-widgets');
		});

		// Find slider components
		const { slider, label } = await test.step('Locate slider and label', async () => {
			const labelElement = sliderWidget.locator('label').filter({ hasText: 'x' });
			await expect(labelElement).toBeVisible();

			const sliderElement = sliderWidget.locator('input[type="range"]');
			await expect(sliderElement).toBeVisible();

			return {
				slider: sliderElement,
				label: labelElement
			};
		});

		// Verify label
		await test.step('Verify slider has correct label "x"', async () => {
			await expect(label).toHaveText('x');
		});

		// Verify slider attributes
		await test.step('Verify slider has correct range (0-100)', async () => {
			const attributes = await IpywidgetsHelpers.getSliderAttributes(slider);
			expect(attributes.min).toBe(0);
			expect(attributes.max).toBe(100);
			expect(attributes.value).toBeGreaterThanOrEqual(0);
			expect(attributes.value).toBeLessThanOrEqual(100);
		});

		// Test slider interactions
		await test.step('Change slider to 10 and verify output shows 100', async () => {
			await IpywidgetsHelpers.setSliderValue(slider, 10);
			await app.code.driver.page.waitForTimeout(500);
			await IpywidgetsHelpers.waitForOutputText(
				notebooksPositron.cellOutput(0),
				'100'
			);
		});

		await test.step('Change slider to 20 and verify output shows 400', async () => {
			await IpywidgetsHelpers.setSliderValue(slider, 20);
			await app.code.driver.page.waitForTimeout(500);
			await IpywidgetsHelpers.waitForOutputText(
				notebooksPositron.cellOutput(0),
				'400'
			);
		});

		await test.step('Change slider to 5 and verify output shows 25', async () => {
			await IpywidgetsHelpers.setSliderValue(slider, 5);
			await app.code.driver.page.waitForTimeout(500);
			await IpywidgetsHelpers.waitForOutputText(
				notebooksPositron.cellOutput(0),
				'25'
			);
		});

		await test.step('Verify slider value updates correctly', async () => {
			await IpywidgetsHelpers.setSliderValue(slider, 42);
			const currentValue = await IpywidgetsHelpers.getSliderValue(slider);
			expect(currentValue).toBe(42);

			await app.code.driver.page.waitForTimeout(500);
			await IpywidgetsHelpers.waitForOutputText(
				notebooksPositron.cellOutput(0),
				'1764'  // 42 * 42 = 1764
			);
		});
	});

	test('Verify slider with custom parameters', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Execute cell with custom slider (min=10, max=50, step=5)', async () => {
			const interactCode = `import ipywidgets as ipw

def g(value):
	print(f"Result: {value * 3}")

ipw.interact(g, value=(10, 50, 5))`;

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		const sliderWidget = await IpywidgetsHelpers.waitForWidget(
			notebooksPositron.cellOutput(0),
			'.jupyter-widgets'
		);

		const slider = sliderWidget.locator('input[type="range"]');
		await expect(slider).toBeVisible();

		await test.step('Verify custom slider attributes', async () => {
			const attributes = await IpywidgetsHelpers.getSliderAttributes(slider);
			expect(attributes.min).toBe(10);
			expect(attributes.max).toBe(50);
			expect(attributes.step).toBe(5);
		});

		await test.step('Test custom slider interaction', async () => {
			await IpywidgetsHelpers.setSliderValue(slider, 30);
			await app.code.driver.page.waitForTimeout(500);
			await IpywidgetsHelpers.waitForOutputText(
				notebooksPositron.cellOutput(0),
				'Result: 90'  // 30 * 3 = 90
			);
		});
	});

	test('Verify multiple slider changes update output correctly', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Setup slider widget', async () => {
			const interactCode = `import ipywidgets as ipw

def compute(n):
	print(f"n={n}, n²={n*n}, n³={n*n*n}")

ipw.interact(compute, n=(0, 10))`;

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		const sliderWidget = await IpywidgetsHelpers.waitForWidget(
			notebooksPositron.cellOutput(0),
			'.jupyter-widgets'
		);
		const slider = sliderWidget.locator('input[type="range"]');

		const testValues = [
			{ input: 2, outputs: ['n=2', 'n²=4', 'n³=8'] },
			{ input: 3, outputs: ['n=3', 'n²=9', 'n³=27'] },
			{ input: 5, outputs: ['n=5', 'n²=25', 'n³=125'] }
		];

		for (const testCase of testValues) {
			await test.step(`Test slider value ${testCase.input}`, async () => {
				await IpywidgetsHelpers.setSliderValue(slider, testCase.input);
				await app.code.driver.page.waitForTimeout(500);

				// Verify all expected outputs appear
				for (const expectedOutput of testCase.outputs) {
					await IpywidgetsHelpers.waitForOutputText(
						notebooksPositron.cellOutput(0),
						expectedOutput
					);
				}
			});
		}
	});
});
