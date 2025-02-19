/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const CURRENT_PLOT = '.plot-instance img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';
const NEXT_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show next plot"]';
const PREVIOUS_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show previous plot"]';
const CLEAR_PLOTS_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Clear all plots"]';
const PLOT_SIZE_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Auto"]';
const SAVE_PLOT_FROM_PLOTS_PANE_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Save plot"]';
const COPY_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Copy plot to clipboard"]';
const ZOOM_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Fit"]';
const OUTER_WEBVIEW_FRAME = '.webview';
const INNER_WEBVIEW_FRAME = '#active-frame';


/*
 *  Reuseable Positron plots functionality for tests to leverage.
 */
export class Plots {

	nextPlotButton: Locator;
	previousPlotButton: Locator;
	clearPlotsButton: Locator;
	plotSizeButton: Locator;
	savePlotFromPlotsPaneButton: Locator;
	savePlotFromEditorButton: Locator;
	copyPlotButton: Locator;
	zoomPlotButton: Locator;
	currentPlot: Locator;
	savePlotModal: Locator;
	overwriteModal: Locator;

	constructor(private code: Code) {
		this.nextPlotButton = this.code.driver.page.locator(NEXT_PLOT_BUTTON);
		this.previousPlotButton = this.code.driver.page.locator(PREVIOUS_PLOT_BUTTON);
		this.clearPlotsButton = this.code.driver.page.locator(CLEAR_PLOTS_BUTTON);
		this.plotSizeButton = this.code.driver.page.locator(PLOT_SIZE_BUTTON);
		this.savePlotFromPlotsPaneButton = this.code.driver.page.locator(SAVE_PLOT_FROM_PLOTS_PANE_BUTTON);
		this.savePlotFromEditorButton = this.code.driver.page.getByRole('button', { name: 'Save Plot From Active Editor' });
		this.copyPlotButton = this.code.driver.page.locator(COPY_PLOT_BUTTON);
		this.zoomPlotButton = this.code.driver.page.locator(ZOOM_PLOT_BUTTON);
		this.currentPlot = this.code.driver.page.locator(CURRENT_PLOT);
		this.savePlotModal = this.code.driver.page.locator('.positron-modal-dialog-box').filter({ hasText: 'Save Plot' });
		this.overwriteModal = this.code.driver.page.locator('.positron-modal-dialog-box').filter({ hasText: 'The file already exists' });
	}

	async waitForCurrentPlot() {
		await expect(this.code.driver.page.locator(CURRENT_PLOT)).toBeVisible({ timeout: 30000 });
	}

	async waitForCurrentStaticPlot() {
		await expect(this.code.driver.page.locator(CURRENT_STATIC_PLOT)).toBeVisible({ timeout: 30000 });
	}

	getWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.page
			.locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
			.locator(INNER_WEBVIEW_FRAME).last().contentFrame()
			.locator(selector);
	}

	getRWebWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.page
			.locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
			.locator(INNER_WEBVIEW_FRAME).last().contentFrame()
			.locator('//iframe').last().contentFrame()
			.locator(selector);
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
		return this.code.driver.page.locator(CURRENT_STATIC_PLOT).screenshot();
	}

	async copyCurrentPlotToClipboard() {
		await this.code.driver.page.locator('.codicon-copy').click();

		// wait for clipboard to be populated
		await this.code.wait(500);
	}

	async savePlotFromPlotsPane({ name, format, overwrite = true }: { name: string; format: 'JPEG' | 'PNG' | 'SVG' | 'PDF' | 'TIFF'; overwrite?: boolean }) {
		// click save and wait for save plot modal
		await this.savePlotFromPlotsPaneButton.click();
		await this.savePlot({ name, format, overwrite });
	}

	async savePlotFromEditor({ name, format, overwrite = true }: { name: string; format: 'JPEG' | 'PNG' | 'SVG' | 'PDF' | 'TIFF'; overwrite?: boolean }) {
		// click save and wait for save plot modal
		await this.savePlotFromEditorButton.click();
		await this.savePlot({ name, format, overwrite });
	}

	private async savePlot({ name, format, overwrite = true }: { name: string; format: 'JPEG' | 'PNG' | 'SVG' | 'PDF' | 'TIFF'; overwrite?: boolean }) {
		await expect(this.savePlotModal).toBeVisible();

		// enter new name and select format
		await this.savePlotModal.getByLabel('Name', { exact: true }).fill(name);
		await this.savePlotModal.getByLabel('Format').click();
		await this.code.driver.page.getByRole('button', { name: format }).click();

		// ensure dropdown value has updated
		await expect(this.savePlotModal.getByLabel(`Format${format}`)).toBeVisible();
		// bug workaround related to RPC timeout
		await this.code.driver.page.waitForTimeout(1000);

		// save plot
		await this.savePlotModal.getByRole('button', { name: 'Save' }).click();

		// handle overwrite dialog
		if (await this.overwriteModal.isVisible()) {
			if (overwrite) {
				await this.overwriteModal.getByRole('button', { name: 'Overwrite' }).click();
				await expect(this.savePlotModal).not.toBeVisible();
			} else {
				await this.overwriteModal.getByRole('button', { name: 'Cancel' }).click();
			}
		} else {
			await expect(this.savePlotModal).not.toBeVisible();
		}
	}

	async openPlotInEditor() {
		await this.code.driver.page.locator('.codicon-go-to-file').click();
	}

	async waitForPlotInEditor() {
		await expect(this.code.driver.page.locator('.editor-container img')).toBeVisible({ timeout: 30000 });
	}
}
