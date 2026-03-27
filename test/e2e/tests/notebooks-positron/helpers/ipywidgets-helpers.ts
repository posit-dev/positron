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
	 * More reliable than attempting to drag the slider with mouse movements.
	 *
	 * @param slider - The slider input locator (input[type="range"])
	 * @param value - The target value to set
	 */
	static async setSliderValue(slider: Locator, value: number): Promise<void> {
		await slider.evaluate((element: HTMLInputElement, val: number) => {
			element.value = val.toString();
			element.dispatchEvent(new Event('input', { bubbles: true }));
			element.dispatchEvent(new Event('change', { bubbles: true }));
		}, value);
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
	 * Wait for widget output to contain specific text.
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
}
