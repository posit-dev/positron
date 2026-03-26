/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { Locator } from '@playwright/test';

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

	test('Verify ipywidgets slider with interact works correctly', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Execute cell with ipywidgets interact code', async () => {
			const interactCode = `import ipywidgets as ipw

def f(x):
    print(x * x)

ipw.interact(f, x=(0, 100))`;

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		// Get the widget locator from the cell output
		const sliderWidget = await test.step('Verify slider widget is rendered', async () => {
			const cellOutput = notebooksPositron.cellOutput(0);
			await expect(cellOutput).toBeVisible();

			// Wait for the widget to appear in the output
			const widget = cellOutput.locator('.jupyter-widgets');
			await expect(widget).toBeVisible({ timeout: 10000 });

			return widget;
		});

		// Find the slider input and label
		const { slider, label, valueDisplay } = await test.step('Locate slider components', async () => {
			// The label with text "x"
			const labelElement = sliderWidget.locator('label').filter({ hasText: 'x' });
			await expect(labelElement).toBeVisible();

			// The slider input element
			const sliderElement = sliderWidget.locator('input[type="range"]');
			await expect(sliderElement).toBeVisible();

			// The value display (typically shows the current numeric value)
			const valueElement = sliderWidget.locator('input[type="number"], .widget-readout');
			await expect(valueElement).toBeVisible();

			return {
				slider: sliderElement,
				label: labelElement,
				valueDisplay: valueElement
			};
		});

		await test.step('Verify slider has correct label', async () => {
			await expect(label).toHaveText('x');
		});

		await test.step('Verify slider has initial value displayed', async () => {
			// Default value for ipywidgets slider with range (0, 100) is typically 50
			const initialValue = await slider.getAttribute('value');
			expect(initialValue).toBeTruthy();
			expect(parseInt(initialValue || '0')).toBeGreaterThanOrEqual(0);
			expect(parseInt(initialValue || '0')).toBeLessThanOrEqual(100);
		});

		await test.step('Verify initial output shows correct computation', async () => {
			// Get the initial slider value
			const initialValue = parseInt(await slider.getAttribute('value') || '50');
			const expectedOutput = (initialValue * initialValue).toString();

			// Find the output area (the printed result)
			const outputArea = notebooksPositron.cellOutput(0).locator('.jp-OutputArea-output, .widget-output');
			await expect(outputArea.getByText(expectedOutput)).toBeVisible({ timeout: 5000 });
		});

		await test.step('Change slider value and verify output updates', async () => {
			// Change slider to value 10
			await changeSliderValue(slider, 10);

			// Wait a moment for the output to update
			await app.code.driver.page.waitForTimeout(500);

			// Verify output shows 10 * 10 = 100
			const outputArea = notebooksPositron.cellOutput(0).locator('.jp-OutputArea-output, .widget-output');
			await expect(outputArea.getByText('100')).toBeVisible({ timeout: 5000 });
		});

		await test.step('Change slider to different value and verify multiple updates', async () => {
			// Change slider to value 20
			await changeSliderValue(slider, 20);
			await app.code.driver.page.waitForTimeout(500);

			// Verify output shows 20 * 20 = 400
			const outputArea = notebooksPositron.cellOutput(0).locator('.jp-OutputArea-output, .widget-output');
			await expect(outputArea.getByText('400')).toBeVisible({ timeout: 5000 });

			// Change slider to value 5
			await changeSliderValue(slider, 5);
			await app.code.driver.page.waitForTimeout(500);

			// Verify output shows 5 * 5 = 25
			await expect(outputArea.getByText('25')).toBeVisible({ timeout: 5000 });
		});

		await test.step('Verify value display updates with slider', async () => {
			await changeSliderValue(slider, 42);
			await app.code.driver.page.waitForTimeout(500);

			// Check if the value display shows 42
			const displayedValue = await getSliderDisplayValue(valueDisplay);
			expect(displayedValue).toBe('42');

			// Verify the computation output
			const outputArea = notebooksPositron.cellOutput(0).locator('.jp-OutputArea-output, .widget-output');
			await expect(outputArea.getByText('1764')).toBeVisible({ timeout: 5000 });
		});
	});

	test('Verify no console errors during slider interaction', async function ({ app, page }) {
		const { notebooksPositron } = app.workbench;
		const consoleErrors: string[] = [];

		// Capture console errors
		page.on('console', (msg) => {
			if (msg.type() === 'error') {
				consoleErrors.push(msg.text());
			}
		});

		await test.step('Execute cell with ipywidgets interact code', async () => {
			const interactCode = `import ipywidgets as ipw

def f(x):
    print(x * x)

ipw.interact(f, x=(0, 100))`;

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		const sliderWidget = notebooksPositron.cellOutput(0).locator('.jupyter-widgets');
		await expect(sliderWidget).toBeVisible({ timeout: 10000 });

		const slider = sliderWidget.locator('input[type="range"]');
		await expect(slider).toBeVisible();

		await test.step('Interact with slider and check for errors', async () => {
			await changeSliderValue(slider, 25);
			await page.waitForTimeout(500);

			await changeSliderValue(slider, 75);
			await page.waitForTimeout(500);

			// Filter out known benign errors (if any)
			const significantErrors = consoleErrors.filter(err =>
				!err.includes('ResizeObserver') && // ResizeObserver errors are typically benign
				!err.includes('deprecated')
			);

			expect(significantErrors).toHaveLength(0);
		});
	});

	test('Verify slider with custom range and step', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Execute cell with custom slider parameters', async () => {
			const interactCode = `import ipywidgets as ipw

def g(value):
    print(f"Value: {value}, Doubled: {value * 2}")

ipw.interact(g, value=(10, 50, 5))`;  // min=10, max=50, step=5

			await notebooksPositron.addCodeToCell(0, interactCode, { run: true });
			await notebooksPositron.waitForExecutionComplete(0);
		});

		const sliderWidget = notebooksPositron.cellOutput(0).locator('.jupyter-widgets');
		await expect(sliderWidget).toBeVisible({ timeout: 10000 });

		const slider = sliderWidget.locator('input[type="range"]');
		await expect(slider).toBeVisible();

		await test.step('Verify slider respects min, max, and step', async () => {
			const min = await slider.getAttribute('min');
			const max = await slider.getAttribute('max');
			const step = await slider.getAttribute('step');

			expect(min).toBe('10');
			expect(max).toBe('50');
			expect(step).toBe('5');
		});

		await test.step('Change slider and verify output', async () => {
			await changeSliderValue(slider, 25);
			await app.code.driver.page.waitForTimeout(500);

			const outputArea = notebooksPositron.cellOutput(0).locator('.jp-OutputArea-output, .widget-output');
			await expect(outputArea.getByText('Value: 25')).toBeVisible({ timeout: 5000 });
			await expect(outputArea.getByText('Doubled: 50')).toBeVisible({ timeout: 5000 });
		});
	});
});

/**
 * Helper function to change slider value programmatically.
 * This approach is more reliable than trying to drag the slider.
 *
 * @param slider - The slider input locator
 * @param value - The target value to set
 */
async function changeSliderValue(slider: Locator, value: number): Promise<void> {
	await slider.evaluate((element: HTMLInputElement, val: number) => {
		element.value = val.toString();
		// Trigger input and change events to ensure the widget processes the update
		element.dispatchEvent(new Event('input', { bubbles: true }));
		element.dispatchEvent(new Event('change', { bubbles: true }));
	}, value);
}

/**
 * Helper function to get the displayed value from the slider's value display.
 *
 * @param valueDisplay - The value display locator (could be input[type="number"] or a div)
 * @returns The displayed value as a string
 */
async function getSliderDisplayValue(valueDisplay: Locator): Promise<string> {
	const tagName = await valueDisplay.evaluate(el => el.tagName.toLowerCase());

	if (tagName === 'input') {
		return await valueDisplay.inputValue();
	} else {
		return (await valueDisplay.textContent())?.trim() || '';
	}
}
