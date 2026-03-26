/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator } from '@playwright/test';

/**
 * Helper utilities for testing ipywidgets in Positron notebooks.
 */
export class IpywidgetsHelpers {

	/**
	 * Change a slider's value programmatically.
	 * This is more reliable than attempting to drag the slider with mouse movements.
	 *
	 * @param slider - The slider input locator (input[type="range"])
	 * @param value - The target value to set
	 */
	static async setSliderValue(slider: Locator, value: number): Promise<void> {
		await slider.evaluate((element: HTMLInputElement, val: number) => {
			element.value = val.toString();
			// Trigger both input and change events to ensure proper widget update
			element.dispatchEvent(new Event('input', { bubbles: true }));
			element.dispatchEvent(new Event('change', { bubbles: true }));
		}, value);
	}

	/**
	 * Get the current value of a slider.
	 *
	 * @param slider - The slider input locator
	 * @returns The current slider value as a number
	 */
	static async getSliderValue(slider: Locator): Promise<number> {
		const value = await slider.getAttribute('value');
		return parseInt(value || '0', 10);
	}

	/**
	 * Get the displayed value from a slider's value readout.
	 * Works with both input[type="number"] and div.widget-readout elements.
	 *
	 * @param valueDisplay - The value display locator
	 * @returns The displayed value as a string
	 */
	static async getDisplayedValue(valueDisplay: Locator): Promise<string> {
		const tagName = await valueDisplay.evaluate(el => el.tagName.toLowerCase());

		if (tagName === 'input') {
			return await valueDisplay.inputValue();
		} else {
			return (await valueDisplay.textContent())?.trim() || '';
		}
	}

	/**
	 * Wait for a widget to appear in a cell's output area.
	 *
	 * @param cellOutput - The cell output locator
	 * @param selector - Optional CSS selector for a specific widget component (default: '.jupyter-widgets')
	 * @param timeout - Optional timeout in milliseconds (default: 10000)
	 * @returns The widget locator
	 */
	static async waitForWidget(
		cellOutput: Locator,
		selector: string = '.jupyter-widgets',
		timeout: number = 10000
	): Promise<Locator> {
		const widget = cellOutput.locator(selector);
		await widget.waitFor({ state: 'visible', timeout });
		return widget;
	}

	/**
	 * Click a button in an ipywidget.
	 *
	 * @param widget - The widget container locator
	 * @param buttonText - The button text or label
	 */
	static async clickButton(widget: Locator, buttonText: string): Promise<void> {
		const button = widget.locator('button', { hasText: buttonText });
		await button.click();
	}

	/**
	 * Set a text input value in an ipywidget.
	 *
	 * @param widget - The widget container locator
	 * @param inputSelector - CSS selector for the input element
	 * @param value - The value to set
	 */
	static async setTextInput(widget: Locator, inputSelector: string, value: string): Promise<void> {
		const input = widget.locator(inputSelector);
		await input.fill(value);
		// Trigger change event
		await input.dispatchEvent('change');
	}

	/**
	 * Select an option from a dropdown widget.
	 *
	 * @param widget - The widget container locator
	 * @param optionValue - The option value to select
	 */
	static async selectDropdownOption(widget: Locator, optionValue: string): Promise<void> {
		const select = widget.locator('select');
		await select.selectOption(optionValue);
	}

	/**
	 * Toggle a checkbox widget.
	 *
	 * @param widget - The widget container locator
	 * @param checked - Whether to check or uncheck the checkbox
	 */
	static async toggleCheckbox(widget: Locator, checked: boolean): Promise<void> {
		const checkbox = widget.locator('input[type="checkbox"]');
		if (checked) {
			await checkbox.check();
		} else {
			await checkbox.uncheck();
		}
	}

	/**
	 * Get slider attributes (min, max, step, value).
	 *
	 * @param slider - The slider input locator
	 * @returns An object containing slider attributes
	 */
	static async getSliderAttributes(slider: Locator): Promise<{
		min: number;
		max: number;
		step: number;
		value: number;
	}> {
		return await slider.evaluate((element: HTMLInputElement) => ({
			min: parseFloat(element.min),
			max: parseFloat(element.max),
			step: parseFloat(element.step),
			value: parseFloat(element.value)
		}));
	}

	/**
	 * Drag a slider to a specific percentage position.
	 * Note: This uses mouse movements and may be less reliable than setSliderValue.
	 *
	 * @param slider - The slider input locator
	 * @param percentage - The target position as a percentage (0-100)
	 */
	static async dragSliderToPercentage(slider: Locator, percentage: number): Promise<void> {
		const boundingBox = await slider.boundingBox();
		if (!boundingBox) {
			throw new Error('Slider bounding box not found');
		}

		const targetX = boundingBox.x + (boundingBox.width * percentage / 100);
		const targetY = boundingBox.y + boundingBox.height / 2;

		await slider.click();
		await slider.page().mouse.move(targetX, targetY);
		await slider.page().mouse.down();
		await slider.page().mouse.move(targetX, targetY);
		await slider.page().mouse.up();
	}

	/**
	 * Wait for widget output to contain specific text.
	 * Useful for verifying that widget interactions trigger the expected output.
	 *
	 * @param cellOutput - The cell output locator
	 * @param expectedText - The text to wait for
	 * @param timeout - Optional timeout in milliseconds (default: 5000)
	 */
	static async waitForOutputText(
		cellOutput: Locator,
		expectedText: string,
		timeout: number = 5000
	): Promise<void> {
		const outputArea = cellOutput.locator('.jp-OutputArea-output, .widget-output');
		await outputArea.getByText(expectedText).waitFor({ state: 'visible', timeout });
	}

	/**
	 * Clear widget output area.
	 * This is useful when you want to verify that new output is generated.
	 *
	 * @param widget - The widget container locator
	 */
	static async clearWidgetOutput(widget: Locator): Promise<void> {
		const outputArea = widget.locator('.widget-output, .jp-OutputArea-output');
		await outputArea.evaluate(el => {
			el.innerHTML = '';
		});
	}
}
