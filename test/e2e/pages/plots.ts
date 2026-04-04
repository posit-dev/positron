/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { fail } from 'assert';
import { ContextMenu } from './dialog-contextMenu.js';

const CURRENT_PLOT = '.plot-instance img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-dynamic-action-bar .codicon-clear-all';
const NEXT_PLOT_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Show next plot"]';
const PREVIOUS_PLOT_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Show previous plot"]';
const CLEAR_PLOTS_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Clear all plots"]';
const PLOT_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button';
const SAVE_PLOT_FROM_PLOTS_PANE_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Save plot"]';
const COPY_PLOT_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Copy plot to clipboard"]';
const ZOOM_PLOT_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Fit"]';
const OPEN_IN_EDITOR_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Open in editor tab"]';
const OPEN_IN_EDITOR_DROPDOWN_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Select where to open plot"]';
const OVERFLOW_MENU_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="overflow"]';
const SESSION_NAME_BUTTON = '.plot-session-name';
const ORIGIN_FILE_BUTTON = '.plot-origin-file';
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
	sessionNameButton: Locator;
	originFileButton: Locator;
	savePlotModal: Locator;
	overwriteModal: Locator;

	constructor(private code: Code, private contextMenu: ContextMenu) {
		this.plotButton = this.code.driver.page.locator(PLOT_BUTTON);
		this.nextPlotButton = this.code.driver.page.locator(NEXT_PLOT_BUTTON);
		this.previousPlotButton = this.code.driver.page.locator(PREVIOUS_PLOT_BUTTON);
		this.clearPlotsButton = this.code.driver.page.locator(CLEAR_PLOTS_BUTTON);
		this.plotSizeButton = this.plotButton.filter({ hasText: /Auto|Square|Portrait|Landscape|Fill|matplotlib|Auto|Intrinsic/ });
		this.savePlotFromPlotsPaneButton = this.code.driver.page.locator(SAVE_PLOT_FROM_PLOTS_PANE_BUTTON);
		this.savePlotFromEditorButton = this.code.driver.page.getByRole('button', { name: 'Save Plot From Active Editor' });
		this.copyPlotButton = this.code.driver.page.locator(COPY_PLOT_BUTTON);
		this.zoomPlotButton = this.code.driver.page.locator(ZOOM_PLOT_BUTTON);
		this.currentPlot = this.code.driver.page.locator(CURRENT_PLOT);
		this.sessionNameButton = this.code.driver.page.locator(SESSION_NAME_BUTTON);
		this.originFileButton = this.code.driver.page.locator(ORIGIN_FILE_BUTTON);
		this.savePlotModal = this.code.driver.page.locator('.positron-modal-dialog-box').filter({ hasText: 'Save Plot' });
		this.overwriteModal = this.code.driver.page.locator('.positron-modal-dialog-box').filter({ hasText: 'The file already exists' });
	}

	/** Action: Click the session name button displayed on the current plot. */
	async clickSessionNameButton() {
		await test.step('Click session name button on plot', async () => {
			await this.sessionNameButton.click();
		});
	}

	/** Action: Click the origin file button to navigate to the source file. */
	async clickOriginFileButton() {
		await test.step('Click origin file button', async () => {
			await this.originFileButton.click();
		});
	}

	/**
	 * Action: Wait for any plot to appear in the Plots pane.
	 * Matches plots rendered in the sidebar or editor. This is the default
	 * plot assertion for matplotlib, seaborn, ggplot2, and other plot types.
	 * @see waitForCurrentStaticPlot for static-only plots in the full-size viewer
	 */
	async waitForCurrentPlot() {
		await test.step('Wait for current plot to be visible', async () => {
			await expect(this.code.driver.page.locator(CURRENT_PLOT)).toBeVisible({ timeout: 30000 });
		});
	}

	/**
	 * Action: Wait for a static (non-webview) plot image in the full-size plot viewer.
	 * Only matches `.static-plot-instance img` -- does not match webview plots or
	 * sidebar thumbnails. Use waitForCurrentPlot for general plot assertions.
	 * @see waitForCurrentPlot for general plot detection (sidebar + editor)
	 */
	async waitForCurrentStaticPlot() {
		await test.step('Wait for current static plot to be visible', async () => {
			await expect(this.code.driver.page.locator(CURRENT_STATIC_PLOT)).toBeVisible({ timeout: 30000 });
		});
	}

	/** Verify: The origin file button is visible in the Plots pane. */
	async expectOriginButtonVisible() {
		await test.step('Expect origin file button to be visible', async () => {
			await expect(this.originFileButton).toBeVisible({ timeout: 30000 });
		});
	}

	/**
	 * Verify: The origin file button contains the expected text.
	 * @param text - Expected text content in the origin file button
	 */
	async expectOriginButtonContain(text: string) {
		await test.step(`Expect origin file button to contain text: ${text}`, async () => {
			await expect(this.originFileButton).toContainText(text);
		});
	}

	/**
	 * Action: Get a locator for an element inside a webview plot.
	 * Use for htmlwidgets, plotly, and other interactive plots rendered in webviews.
	 * @param selector - CSS selector to find within the webview iframe
	 */
	getWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.page
			.locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
			.locator(INNER_WEBVIEW_FRAME).last().contentFrame()
			.locator(selector);
	}

	/**
	 * Action: Get a locator for an element inside a deeply nested webview plot.
	 * Use for R htmlwidgets that use an extra iframe layer (e.g., Shiny, leaflet).
	 * @param selector - CSS selector to find within the nested webview iframe
	 */
	getDeepWebWebviewPlotLocator(selector: string): Locator {
		return this.code.driver.page
			.locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
			.locator(INNER_WEBVIEW_FRAME).last().contentFrame()
			.locator('//iframe').last().contentFrame()
			.locator(selector);
	}

	/**
	 * Action: Wait for a webview-based plot to appear.
	 * Use for interactive plots (plotly, htmlwidgets) rendered inside webview iframes.
	 * @param selector - CSS selector to match within the webview
	 * @param state - Wait for 'attached' (in DOM) or 'visible' (rendered). Default: 'visible'
	 * @param RWeb - Set true for R htmlwidgets with an extra iframe nesting layer
	 * @see waitForCurrentPlot for static image plots (matplotlib, ggplot2)
	 */
	async waitForWebviewPlot(selector: string, state: 'attached' | 'visible' = 'visible', RWeb = false) {
		const locator = RWeb ? this.getDeepWebWebviewPlotLocator(selector) : this.getWebviewPlotLocator(selector);

		if (state === 'attached') {
			await expect(locator).toBeAttached({ timeout: 15000 });
		} else {
			await expect(locator).toBeVisible({ timeout: 15000 });
		}
	}

	/** Action: Clear all plots from the Plots pane. No-op if no plots exist. */
	async clearPlots() {
		const clearPlotsButton = this.code.driver.page.locator(CLEAR_PLOTS);

		if (await clearPlotsButton.isVisible() && await clearPlotsButton.isEnabled()) {
			await clearPlotsButton.click();
		}
	}

	/**
	 * Verify: No plots are visible in the Plots pane.
	 * @param options.timeout - How long to wait for plots to disappear. Default: 15000ms
	 */
	async waitForNoPlots({ timeout = 15000 }: { timeout?: number } = {}) {
		await expect(this.code.driver.page.locator(CURRENT_PLOT)).not.toBeVisible({ timeout });
	}

	/** Action: Capture the current plot as a screenshot buffer. */
	async getCurrentPlotAsBuffer(): Promise<Buffer> {
		return this.currentPlot.screenshot();
	}

	/**
	 * Action: Capture the current static plot as a screenshot buffer.
	 * @see getCurrentPlotAsBuffer for the general version
	 */
	async getCurrentStaticPlotAsBuffer(): Promise<Buffer> {
		return this.code.driver.page.locator(CURRENT_STATIC_PLOT).screenshot();
	}

	/** Action: Click the copy-to-clipboard button on the current plot. */
	async copyCurrentPlotToClipboard() {
		await this.code.driver.page.locator('.codicon-copy').click();

		// wait for clipboard to be populated
		await this.code.wait(500);
	}

	/**
	 * Action: Save the current plot from the Plots pane sidebar.
	 * Opens the save dialog, fills in name and format, and handles overwrite.
	 * @param name - File name for the saved plot (without extension)
	 * @param format - Image format: 'JPEG', 'PNG', 'SVG', 'PDF', or 'TIFF'
	 * @param overwrite - Whether to overwrite if file exists. Default: true
	 * @see savePlotFromEditor to save from an editor tab instead
	 */
	async savePlotFromPlotsPane({ name, format, overwrite = true }: { name: string; format: 'JPEG' | 'PNG' | 'SVG' | 'PDF' | 'TIFF'; overwrite?: boolean }) {
		// click save and wait for save plot modal
		await this.savePlotFromPlotsPaneButton.click();
		await this.savePlot({ name, format, overwrite });
	}

	/**
	 * Action: Save the current plot from the editor tab.
	 * Opens the save dialog, fills in name and format, and handles overwrite.
	 * @param name - File name for the saved plot (without extension)
	 * @param format - Image format: 'JPEG', 'PNG', 'SVG', 'PDF', or 'TIFF'
	 * @param overwrite - Whether to overwrite if file exists. Default: true
	 * @see savePlotFromPlotsPane to save from the sidebar instead
	 */
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

	/** Action: Click the "Go to file" button on the current plot. */
	async clickGoToFileButton() {
		await this.code.driver.page.locator('.codicon-go-to-file').click();
	}

	/**
	 * Action: Set the zoom level for the current plot.
	 * @param zoomLevel - Target zoom: 'Fit', '50%', '75%', '100%', or '200%'
	 */
	async setThePlotZoom(zoomLevel: ZoomLevels) {
		await test.step(`Set plot zoom to: ${zoomLevel}`, async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.code.driver.page.getByRole('button', { name: /Fit|%/ }),
				menuItemLabel: zoomLevel
			});
		});
	}

	/**
	 * Action: Open the current plot in a specified location.
	 * @param plotLocation - Where to open: 'editor', 'new window', or 'editor tab to the side'
	 */
	async openPlotIn(plotLocation: PlotLocations) {
		const menuItemRegex = {
			'editor': /Open in editor tab$/,
			'new window': /Open in new window$/,
			'editor tab to the side': /Open in editor tab to the Side$/
		};
		await test.step(`Open plot in: ${plotLocation}`, async () => {
			// The "Open in Editor" button may be visible in the action bar or overflowed into the overflow menu.
			// First check if the dropdown button is visible, otherwise use the overflow menu.

			const openInEditorButton = this.code.driver.page.locator(OPEN_IN_EDITOR_DROPDOWN_BUTTON);
			const overflowButton = this.code.driver.page.locator(OVERFLOW_MENU_BUTTON);

			if (await openInEditorButton.isVisible()) {
				// Button is visible in action bar - use the dropdown
				await this.contextMenu.triggerAndClick({
					menuTrigger: openInEditorButton,
					menuItemLabel: menuItemRegex[plotLocation],
					menuItemType: 'menuitemcheckbox'
				});
			} else if (await overflowButton.isVisible()) {
				// Button overflowed - use the overflow menu and its submenu
				await overflowButton.click();
				const overflowMenu = this.code.driver.page.locator('.custom-context-menu-items');
				await expect(overflowMenu).toBeVisible();

				// Click on the "Open in Editor" menu option to see submenu entries
				const openInEditorSubmenu = overflowMenu.getByText('Open in Editor');
				await openInEditorSubmenu.click();

				// Wait for submenu to appear and click the appropriate item
				const submenuItem = this.code.driver.page.locator('.custom-context-menu-items').last().getByText(menuItemRegex[plotLocation]);
				await expect(submenuItem).toBeVisible();
				await submenuItem.click();
			} else {
				throw new Error('Could not find "Open in Editor" button in action bar or overflow menu');
			}
		});
	}

	/** Action: Click the main "Open in editor tab" button (no dropdown). */
	async clickOpenInEditorButton() {
		await test.step('Click the main Open in Editor button', async () => {
			const openInEditorButton = this.code.driver.page.locator(OPEN_IN_EDITOR_BUTTON);
			await openInEditorButton.click();
		});
	}

	/**
	 * Verify: The "Open in Editor" dropdown has the expected option checked.
	 * @param expectedOption - Which location should be checked
	 */
	async verifyOpenPlotDropdownCheckedOption(expectedOption: PlotLocations) {
		const menuItemLabels: Record<PlotLocations, string> = {
			'editor': 'Open in editor tab',
			'new window': 'Open in new window',
			'editor tab to the side': 'Open in editor tab to the Side'
		};
		await test.step(`Verify dropdown checked option is: ${expectedOption}`, async () => {
			const openInEditorButton = this.code.driver.page.locator(OPEN_IN_EDITOR_DROPDOWN_BUTTON);
			await this.contextMenu.triggerAndVerifyMenuItems({
				menuTrigger: openInEditorButton,
				menuItemStates: Object.entries(menuItemLabels).map(([key, label]) => ({
					label,
					checked: key === expectedOption
				}))
			});
		});
	}

	/** Action: Wait for a plot image to appear in an editor tab (not the sidebar). */
	async waitForPlotInEditor() {
		await expect(this.code.driver.page.locator('.editor-container img')).toBeVisible({ timeout: 30000 });
	}

	/**
	 * Verify: The expected number of plot thumbnails are visible.
	 * @param count - Expected number of thumbnail images
	 */
	async expectPlotThumbnailsCountToBe(count: number) {
		await expect(this.code.driver.page.locator('.plot-thumbnail')).toHaveCount(count);
	}

	/** Action: Enlarge the Plots pane area by dragging sashes inward. */
	async enlargePlotArea() {
		await this.alterPlotArea(-150, -150);
	}

	/** Action: Restore the Plots pane area to its original size after enlarging. */
	async restorePlotArea() {
		await this.alterPlotArea(150, 150);
	}

	/**
	 * Action: Resize the Plots pane area by dragging sashes.
	 * @param xDelta - Horizontal drag distance in pixels (negative = enlarge)
	 * @param yDelta - Vertical drag distance in pixels (negative = enlarge)
	 */
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
