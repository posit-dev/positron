/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../code';

const CURRENT_PLOT = '.plot-instance img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';
const NEXT_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show next plot"]';
const PREVIOUS_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show previous plot"]';
const CLEAR_PLOTS_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Clear all plots"]';
const PLOT_SIZE_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Auto"]';
const SAVE_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Save plot"]';
const COPY_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Copy plot to clipboard"]';
const ZOOM_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Fit"]';
const OUTER_WEBVIEW_FRAME = '.webview';
const INNER_WEBVIEW_FRAME = '#active-frame';


/*
 *  Reuseable Positron plots functionality for tests to leverage.
 */
export class PositronPlots {

	nextPlotButton: Locator;
	previousPlotButton: Locator;
	clearPlotsButton: Locator;
	plotSizeButton: Locator;
	savePlotButton: Locator;
	copyPlotButton: Locator;
	zoomPlotButton: Locator;
	currentPlot: Locator;

	constructor(private code: Code) {
		this.nextPlotButton = this.code.driver.getLocator(NEXT_PLOT_BUTTON);
		this.previousPlotButton = this.code.driver.getLocator(PREVIOUS_PLOT_BUTTON);
		this.clearPlotsButton = this.code.driver.getLocator(CLEAR_PLOTS_BUTTON);
		this.plotSizeButton = this.code.driver.getLocator(PLOT_SIZE_BUTTON);
		this.savePlotButton = this.code.driver.getLocator(SAVE_PLOT_BUTTON);
		this.copyPlotButton = this.code.driver.getLocator(COPY_PLOT_BUTTON);
		this.zoomPlotButton = this.code.driver.getLocator(ZOOM_PLOT_BUTTON);
		this.currentPlot = this.code.driver.getLocator(CURRENT_PLOT);
	}

	async waitForCurrentPlot() {
		await expect(this.code.driver.page.locator(CURRENT_PLOT)).toBeVisible({ timeout: 30000 });
	}

	async waitForCurrentStaticPlot() {
		await expect(this.code.driver.page.locator(CURRENT_STATIC_PLOT)).toBeVisible({ timeout: 30000 });
	}

	getWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.getFrame(OUTER_WEBVIEW_FRAME).last().frameLocator(INNER_WEBVIEW_FRAME).last().locator(selector);
	}

	getRWebWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.getFrame(OUTER_WEBVIEW_FRAME).last().frameLocator(INNER_WEBVIEW_FRAME).last().frameLocator('//iframe').last().locator(selector);
	}

	async waitForWebviewPlot(selector: string, state: 'attached' | 'visible' = 'visible', RWeb = false) {
		const locator = RWeb ? this.getRWebWebviewPlotLocator(selector) : this.getWebviewPlotLocator(selector);

		if (state === 'attached') {
			await expect(locator).toBeAttached({ timeout: 30000 });
		} else {
			await expect(locator).toBeVisible({ timeout: 30000 });
		}
	}

	async clearPlots() {
		const clearPlotsButton = this.code.driver.page.locator(CLEAR_PLOTS);

		if (await clearPlotsButton.isVisible() && await clearPlotsButton.isEnabled()) {
			await clearPlotsButton.click();
		}
	}

	async waitForNoPlots() {
		await expect(this.code.driver.page.locator(CURRENT_PLOT)).not.toBeVisible();
	}

	async getCurrentPlotAsBuffer(): Promise<Buffer> {
		return this.currentPlot.screenshot();
	}

	async getCurrentStaticPlotAsBuffer(): Promise<Buffer> {
		return this.code.driver.getLocator(CURRENT_STATIC_PLOT).screenshot();
	}

	async copyCurrentPlotToClipboard() {
		await this.code.driver.page.locator('.codicon-copy').click();

		// wait for clipboard to be populated
		await this.code.wait(500);
	}
}
