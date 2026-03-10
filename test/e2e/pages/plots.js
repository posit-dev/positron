"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Plots = void 0;
const test_1 = __importStar(require("@playwright/test"));
const assert_1 = require("assert");
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
const OPEN_IN_EDITOR_DROPDOWN_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="Select where to open plot"]';
const OVERFLOW_MENU_BUTTON = '.positron-plots-container .positron-dynamic-action-bar .positron-button[aria-label="overflow"]';
const ORIGIN_FILE_BUTTON = '.plot-origin-file';
const OUTER_WEBVIEW_FRAME = '.webview';
const INNER_WEBVIEW_FRAME = '#active-frame';
/*
 *  Reuseable Positron plots functionality for tests to leverage.
 */
class Plots {
    code;
    contextMenu;
    plotButton;
    nextPlotButton;
    previousPlotButton;
    clearPlotsButton;
    plotSizeButton;
    savePlotFromPlotsPaneButton;
    savePlotFromEditorButton;
    copyPlotButton;
    zoomPlotButton;
    currentPlot;
    originFileButton;
    savePlotModal;
    overwriteModal;
    constructor(code, contextMenu) {
        this.code = code;
        this.contextMenu = contextMenu;
        this.plotButton = this.code.driver.currentPage.locator(PLOT_BUTTON);
        this.nextPlotButton = this.code.driver.currentPage.locator(NEXT_PLOT_BUTTON);
        this.previousPlotButton = this.code.driver.currentPage.locator(PREVIOUS_PLOT_BUTTON);
        this.clearPlotsButton = this.code.driver.currentPage.locator(CLEAR_PLOTS_BUTTON);
        this.plotSizeButton = this.plotButton.filter({ hasText: /Auto|Square|Portrait|Landscape|Fill|matplotlib|Auto|Intrinsic/ });
        this.savePlotFromPlotsPaneButton = this.code.driver.currentPage.locator(SAVE_PLOT_FROM_PLOTS_PANE_BUTTON);
        this.savePlotFromEditorButton = this.code.driver.currentPage.getByRole('button', { name: 'Save Plot From Active Editor' });
        this.copyPlotButton = this.code.driver.currentPage.locator(COPY_PLOT_BUTTON);
        this.zoomPlotButton = this.code.driver.currentPage.locator(ZOOM_PLOT_BUTTON);
        this.currentPlot = this.code.driver.currentPage.locator(CURRENT_PLOT);
        this.originFileButton = this.code.driver.currentPage.locator(ORIGIN_FILE_BUTTON);
        this.savePlotModal = this.code.driver.currentPage.locator('.positron-modal-dialog-box').filter({ hasText: 'Save Plot' });
        this.overwriteModal = this.code.driver.currentPage.locator('.positron-modal-dialog-box').filter({ hasText: 'The file already exists' });
    }
    async clickOriginFileButton() {
        await test_1.default.step('Click origin file button', async () => {
            await this.originFileButton.click();
        });
    }
    async waitForCurrentPlot() {
        await test_1.default.step('Wait for current plot to be visible', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(CURRENT_PLOT)).toBeVisible({ timeout: 30000 });
        });
    }
    async waitForCurrentStaticPlot() {
        await test_1.default.step('Wait for current static plot to be visible', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(CURRENT_STATIC_PLOT)).toBeVisible({ timeout: 30000 });
        });
    }
    async expectOriginButtonVisible() {
        await test_1.default.step('Expect origin file button to be visible', async () => {
            await (0, test_1.expect)(this.originFileButton).toBeVisible({ timeout: 30000 });
        });
    }
    async expectOriginButtonContain(text) {
        await test_1.default.step(`Expect origin file button to contain text: ${text}`, async () => {
            await (0, test_1.expect)(this.originFileButton).toContainText(text);
        });
    }
    getWebviewPlotLocator(selector) {
        return this.code.driver.currentPage
            .locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
            .locator(INNER_WEBVIEW_FRAME).last().contentFrame()
            .locator(selector);
    }
    getDeepWebWebviewPlotLocator(selector) {
        return this.code.driver.currentPage
            .locator(OUTER_WEBVIEW_FRAME).last().contentFrame()
            .locator(INNER_WEBVIEW_FRAME).last().contentFrame()
            .locator('//iframe').last().contentFrame()
            .locator(selector);
    }
    async waitForWebviewPlot(selector, state = 'visible', RWeb = false) {
        const locator = RWeb ? this.getDeepWebWebviewPlotLocator(selector) : this.getWebviewPlotLocator(selector);
        if (state === 'attached') {
            await (0, test_1.expect)(locator).toBeAttached({ timeout: 15000 });
        }
        else {
            await (0, test_1.expect)(locator).toBeVisible({ timeout: 15000 });
        }
    }
    async clearPlots() {
        const clearPlotsButton = this.code.driver.currentPage.locator(CLEAR_PLOTS);
        if (await clearPlotsButton.isVisible() && await clearPlotsButton.isEnabled()) {
            await clearPlotsButton.click();
        }
    }
    async waitForNoPlots({ timeout = 15000 } = {}) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(CURRENT_PLOT)).not.toBeVisible({ timeout });
    }
    async getCurrentPlotAsBuffer() {
        return this.currentPlot.screenshot();
    }
    async getCurrentStaticPlotAsBuffer() {
        return this.code.driver.currentPage.locator(CURRENT_STATIC_PLOT).screenshot();
    }
    async copyCurrentPlotToClipboard() {
        await this.code.driver.currentPage.locator('.codicon-copy').click();
        // wait for clipboard to be populated
        await this.code.wait(500);
    }
    async savePlotFromPlotsPane({ name, format, overwrite = true }) {
        // click save and wait for save plot modal
        await this.savePlotFromPlotsPaneButton.click();
        await this.savePlot({ name, format, overwrite });
    }
    async savePlotFromEditor({ name, format, overwrite = true }) {
        // click save and wait for save plot modal
        await this.savePlotFromEditorButton.click();
        await this.savePlot({ name, format, overwrite });
    }
    async savePlot({ name, format, overwrite = true }) {
        await (0, test_1.expect)(this.savePlotModal).toBeVisible();
        // enter new name and select format
        await this.savePlotModal.getByLabel('Name', { exact: true }).fill(name);
        await this.savePlotModal.getByLabel('Format').click();
        await this.code.driver.currentPage.getByRole('button', { name: format }).click();
        // ensure dropdown value has updated
        await (0, test_1.expect)(this.savePlotModal.getByLabel(`Format${format}`)).toBeVisible();
        // bug workaround related to RPC timeout
        await this.code.driver.currentPage.waitForTimeout(1000);
        // save plot
        await this.savePlotModal.getByRole('button', { name: 'Save' }).click();
        // handle overwrite dialog
        if (await this.overwriteModal.isVisible()) {
            if (overwrite) {
                await this.overwriteModal.getByRole('button', { name: 'Overwrite' }).click();
                await (0, test_1.expect)(this.savePlotModal).not.toBeVisible();
            }
            else {
                await this.overwriteModal.getByRole('button', { name: 'Cancel' }).click();
            }
        }
        else {
            await (0, test_1.expect)(this.savePlotModal).not.toBeVisible();
        }
    }
    async clickGoToFileButton() {
        await this.code.driver.currentPage.locator('.codicon-go-to-file').click();
    }
    async setThePlotZoom(zoomLevel) {
        await test_1.default.step(`Set plot zoom to: ${zoomLevel}`, async () => {
            await this.contextMenu.triggerAndClick({
                menuTrigger: this.code.driver.currentPage.getByRole('button', { name: /Fit|%/ }),
                menuItemLabel: zoomLevel
            });
        });
    }
    async openPlotIn(plotLocation) {
        const menuItemRegex = {
            'editor': /Open in editor tab$/,
            'new window': /Open in new window$/,
            'editor tab to the side': /Open in editor tab to the Side$/
        };
        await test_1.default.step(`Open plot in: ${plotLocation}`, async () => {
            // The "Open in Editor" button may be visible in the action bar or overflowed into the overflow menu.
            // First check if the dropdown button is visible, otherwise use the overflow menu.
            const openInEditorButton = this.code.driver.currentPage.locator(OPEN_IN_EDITOR_DROPDOWN_BUTTON);
            const overflowButton = this.code.driver.currentPage.locator(OVERFLOW_MENU_BUTTON);
            if (await openInEditorButton.isVisible()) {
                // Button is visible in action bar - use the dropdown
                await this.contextMenu.triggerAndClick({
                    menuTrigger: openInEditorButton,
                    menuItemLabel: menuItemRegex[plotLocation],
                    menuItemType: 'menuitemcheckbox'
                });
            }
            else if (await overflowButton.isVisible()) {
                // Button overflowed - use the overflow menu and its submenu
                await overflowButton.click();
                const overflowMenu = this.code.driver.currentPage.locator('.custom-context-menu-items');
                await (0, test_1.expect)(overflowMenu).toBeVisible();
                // Click on the "Open in Editor" menu option to see submenu entries
                const openInEditorSubmenu = overflowMenu.getByText('Open in Editor');
                await openInEditorSubmenu.click();
                // Wait for submenu to appear and click the appropriate item
                const submenuItem = this.code.driver.currentPage.locator('.custom-context-menu-items').last().getByText(menuItemRegex[plotLocation]);
                await (0, test_1.expect)(submenuItem).toBeVisible();
                await submenuItem.click();
            }
            else {
                throw new Error('Could not find "Open in Editor" button in action bar or overflow menu');
            }
        });
    }
    async waitForPlotInEditor() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.editor-container img')).toBeVisible({ timeout: 30000 });
    }
    async expectPlotThumbnailsCountToBe(count) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.plot-thumbnail')).toHaveCount(count);
    }
    async enlargePlotArea() {
        await this.alterPlotArea(-150, -150);
    }
    async restorePlotArea() {
        await this.alterPlotArea(150, 150);
    }
    async alterPlotArea(xDelta, yDelta) {
        const vericalSashLocator = this.code.driver.currentPage.locator('.monaco-sash.vertical').nth(2);
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
        }
        else {
            (0, assert_1.fail)('Vertical sash bounding box not found');
        }
        const horizontalSashLocator = this.code.driver.currentPage.locator('.auxiliarybar .monaco-sash.horizontal').nth(0);
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
        }
        else {
            (0, assert_1.fail)('Horizontal sash bounding box not found');
        }
    }
}
exports.Plots = Plots;
//# sourceMappingURL=plots.js.map