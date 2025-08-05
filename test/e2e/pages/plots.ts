/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { fail } from 'assert';
import { ContextMenu } from './dialog-contextMenu.js';

const CURRENT_PLOT = '.plot-instance img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';
const NEXT_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show next plot"]';
const PREVIOUS_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show previous plot"]';
const CLEAR_PLOTS_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Clear all plots"]';
const PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button';
const SAVE_PLOT_FROM_PLOTS_PANE_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Save plot"]';
const COPY_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Copy plot to clipboard"]';
const ZOOM_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Fit"]';
const OUTER_WEBVIEW_FRAME = '.webview';
const INNER_WEBVIEW_FRAME = '#active-frame';


/*
 *  Reuseable Positron plots functionality for tests to leverage.
 */
export class Plots {
	plotButton: Locator;
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

	constructor(private code: Code, private contextMenu: ContextMenu) {
		this.plotButton = this.code.driver.page.locator(PLOT_BUTTON);
		this.nextPlotButton = this.code.driver.page.locator(NEXT_PLOT_BUTTON);
		this.previousPlotButton = this.code.driver.page.locator(PREVIOUS_PLOT_BUTTON);
		this.clearPlotsButton = this.code.driver.page.locator(CLEAR_PLOTS_BUTTON);
		this.plotSizeButton = this.plotButton.filter({ hasText: /Auto|Square|Portrait|Landscape|Fill|Matplotlib|Auto|Intrinsic/ });
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

	getDeepWebWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.page
			.locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
			.locator(INNER_WEBVIEW_FRAME).last().contentFrame()
			.locator('//iframe').last().contentFrame()
			.locator(selector);
	}

	async waitForWebviewPlot(selector: string, state: 'attached' | 'visible' = 'visible', RWeb = false) {
		const locator = RWeb ? this.getDeepWebWebviewPlotLocator(selector) : this.getWebviewPlotLocator(selector);

		if (state === 'attached') {
			await expect(locator).toBeAttached({ timeout: 15000 });
		} else {
			await expect(locator).toBeVisible({ timeout: 15000 });
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

	async clickGoToFileButton() {
		await this.code.driver.page.locator('.codicon-go-to-file').click();
	}


	async setThePlotZoom(zoomLevel: ZoomLevels) {
		await test.step(`Set plot zoom to ${zoomLevel}`, async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.code.driver.page.getByRole('button', { name: /Fit|%/ }),
				menuItemLabel: zoomLevel
			});
		});
	}

	async openPlotIn(plotLocation: PlotLocations) {
		const menuItemRegex = {
			'editor': /Open in editor tab$/,
			'new window': /Open in new window$/,
			'editor tab to the side': /Open in editor tab to the Side$/
		};
		await test.step(`Open plot in ${plotLocation}`, async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.code.driver.page.getByRole('button', { name: 'Select where to open plot' }),
				menuItemLabel: menuItemRegex[plotLocation],
				menuItemType: 'menuitemcheckbox'
			});
		});
	}

	async waitForPlotInEditor() {
		await expect(this.code.driver.page.locator('.editor-container img')).toBeVisible({ timeout: 30000 });
	}

	async expectPlotThumbnailsCountToBe(count: number) {
		await expect(this.code.driver.page.locator('.plot-thumbnail')).toHaveCount(count);
	}

	async enlargePlotArea() {
		await this.alterPlotArea(-150, -150);
	}

	async restorePlotArea() {
		await this.alterPlotArea(150, 150);
	}

	async alterPlotArea(xDelta: number, yDelta: number) {

		const vericalSashLocator = this.code.driver.page.locator('.monaco-sash.vertical').nth(2);
		const verticalSashBoundingBox = await vericalSashLocator.boundingBox();

		if (verticalSashBoundingBox) {

			await this.code.driver.clickAndDrag({
				from: {
					x: verticalSashBoundingBox.x,
					y: verticalSashBoundingBox.y + 10
				},
				to: {
					x: verticalSashBoundingBox.x + xDelta,
					y: verticalSashBoundingBox.y + 10
				}
			});
		} else {
			fail('Vertical sash bounding box not found');
		}

		const horizontalSashLocator = this.code.driver.page.locator('.auxiliarybar .monaco-sash.horizontal').nth(0);
		const horizontalSashBoundingBox = await horizontalSashLocator.boundingBox();

		if (horizontalSashBoundingBox) {

			await this.code.driver.clickAndDrag({
				from: {
					x: horizontalSashBoundingBox.x + 10,
					y: horizontalSashBoundingBox.y
				},
				to: {
					x: horizontalSashBoundingBox.x + 10,
					y: horizontalSashBoundingBox.y + yDelta
				}
			});
		} else {
			fail('Horizontal sash bounding box not found');
		}

	}
}

type ZoomLevels = 'Fit' | '50%' | '75%' | '100%' | '200%';
type PlotLocations = 'editor' | 'new window' | 'editor tab to the side';
