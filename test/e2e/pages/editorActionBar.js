"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
exports.EditorActionBar = void 0;
const test_1 = __importStar(require("@playwright/test"));
class EditorActionBar {
    page;
    viewer;
    quickaccess;
    get actionBar() { return this.page.locator('.editor-action-bar > .positron-action-bar > .action-bar-region'); }
    constructor(page, viewer, quickaccess) {
        this.page = page;
        this.viewer = viewer;
        this.quickaccess = quickaccess;
    }
    // --- Actions ---
    /**
     * Action: Click a specified button in the editor action bar.
     * Note: Adds hover before click to prevent test flakes in CI.
     * Special handling is included for the "Split Editor Down" action (requires holding Alt key).
     *
     * @param button - Name of the button to click in the editor action bar.
     */
    async clickButton(button) {
        const buttonLocator = this.page.getByLabel(button, { exact: true });
        if (button === 'Split Editor Down') {
            // Special case: "Split Editor Down" requires holding Alt key
            await this.page.keyboard.down('Alt');
            await buttonLocator.hover();
            await buttonLocator.click();
            await this.page.keyboard.up('Alt');
        }
        else {
            // General case: Hover and click the button
            await buttonLocator.hover();
            await buttonLocator.click();
        }
    }
    /**
     * Action: Set the summary position to the specified side.
     * @param isWeb whether the test is running in the web or desktop app
     * @param position select 'Left' or 'Right' to position the summary
     */
    async selectSummaryOn(isWeb, position) {
        if (isWeb) {
            await this.page.getByLabel('More actions', { exact: true }).click();
            await this.page.getByRole('menuitemcheckbox', { name: `Summary on ${position}` }).hover();
            await this.page.keyboard.press('Enter');
        }
        else {
            await this.quickaccess.runCommand(`workbench.action.positronDataExplorer.summaryOn${position}`);
        }
    }
    /**
     * Action: Click a menu item in the "Customize Notebook" dropdown.
     * @param menuItem a menu item to click in the "Customize Notebook" dropdown
     */
    async clickCustomizeNotebookMenuItem(menuItem) {
        const role = menuItem.includes('Line Numbers') ? 'menuitemcheckbox' : 'menuitem';
        const dropdownButton = this.page.getByLabel('Customize Notebook...');
        await dropdownButton.evaluate((button) => {
            button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        });
        const toggleMenuItem = this.page.getByRole(role, { name: menuItem });
        await toggleMenuItem.hover();
        await this.page.waitForTimeout(500);
        await toggleMenuItem.click();
    }
    // --- Verifications ---
    /**
     * Verify: Check that the editor is split in the specified direction (on the correct plane)
     * @param direction the direction the editor was split
     * @param tabName the name of the tab to verify
     */
    async verifySplitEditor(direction, tabName) {
        await test_1.default.step(`Verify split editor: ${direction}`, async () => {
            // Verify 2 tabs
            await (0, test_1.expect)(this.page.getByRole('tab', { name: tabName })).toHaveCount(2, { timeout: 10000 });
            const splitTabs = this.page.getByRole('tab', { name: tabName });
            const firstTabBox = await splitTabs.nth(0).boundingBox();
            const secondTabBox = await splitTabs.nth(1).boundingBox();
            if (direction === 'right') {
                // Verify tabs are on the same X plane
                (0, test_1.expect)(firstTabBox).not.toBeNull();
                (0, test_1.expect)(secondTabBox).not.toBeNull();
                (0, test_1.expect)(firstTabBox.y).toBeCloseTo(secondTabBox.y, 1);
                (0, test_1.expect)(firstTabBox.x).not.toBeCloseTo(secondTabBox.x, 1);
            }
            else {
                // Verify tabs are on the same Y plane
                (0, test_1.expect)(firstTabBox).not.toBeNull();
                (0, test_1.expect)(secondTabBox).not.toBeNull();
                (0, test_1.expect)(firstTabBox.x).toBeCloseTo(secondTabBox.x, 1);
                (0, test_1.expect)(firstTabBox.y).not.toBeCloseTo(secondTabBox.y, 1);
            }
            // Close one tab
            await splitTabs.first().getByLabel('Close').click();
        });
    }
    /**
     * Verify: Check that the "open in new window" contains the specified text
     * @param isWeb whether the test is running in the web or desktop app
     * @param text the text to verify in the new window
     */
    async verifyOpenInNewWindow(isWeb, text, exact = true) {
        if (!isWeb) {
            await test_1.default.step(`Verify "open new window" contains: ${text}`, async () => {
                const [newPage] = await Promise.all([
                    this.page.context().waitForEvent('page'),
                    this.clickButton('Move into new window')
                ]);
                await newPage.waitForLoadState('load');
                exact
                    ? await (0, test_1.expect)(newPage.getByText(text, { exact: true })).toBeVisible()
                    : await (0, test_1.expect)(newPage.getByText(text)).toBeVisible();
            });
        }
    }
    /**
     * Verify: Check that the preview renders the specified heading
     * @param heading the heading to verify in the preview
     */
    async verifyPreviewRendersHtml(heading) {
        await test_1.default.step('Verify "preview" renders html', async () => {
            await this.page.getByLabel('Preview', { exact: true }).nth(0).click();
            const viewerFrame = this.viewer.getViewerFrame().frameLocator('iframe');
            await (0, test_1.expect)(viewerFrame.getByRole('heading', { name: heading })).toBeVisible({ timeout: 60000 });
        });
    }
    /**
     * Verify: Check that the "open in viewer" renders the specified title
     * @param isWeb whether the test is running in the web or desktop app
     * @param title the title to verify in the viewer
     */
    async verifyOpenViewerRendersHtml(isWeb, title) {
        await test_1.default.step('verify "open in viewer" renders html', async () => {
            const viewerFrame = this.page.locator('iframe.webview').contentFrame().locator('#active-frame').contentFrame();
            const cellLocator = isWeb
                ? viewerFrame.frameLocator('iframe').getByRole('cell', { name: title })
                : viewerFrame.getByRole('cell', { name: title });
            await (0, test_1.expect)(cellLocator).toBeVisible({ timeout: 30000 });
        });
    }
    /**
     * Verify: Check that the summary is positioned on the specified side
     * @param position the side to verify the summary is positioned
     */
    async verifySummaryPosition(position) {
        await test_1.default.step(`Verify summary position: ${position}`, async () => {
            // Get the summary and table locators.
            const summaryLocator = this.page.locator('div.column-summary').first();
            const tableLocator = this.page.locator('div.data-grid-column-headers');
            // Ensure both the summary and table elements are visible
            await (0, test_1.expect)(summaryLocator).toBeVisible();
            await (0, test_1.expect)(tableLocator).toBeVisible();
            // Get the bounding boxes for both elements
            const summaryBox = await summaryLocator.boundingBox();
            const tableBox = await tableLocator.boundingBox();
            // Validate bounding boxes are available
            if (!summaryBox || !tableBox) {
                throw new Error('Bounding boxes could not be retrieved for summary or table.');
            }
            // Validate positions based on the expected position
            position === 'Left'
                ? (0, test_1.expect)(summaryBox.x).toBeLessThan(tableBox.x)
                : (0, test_1.expect)(summaryBox.x).toBeGreaterThan(tableBox.x);
        });
    }
    /**
     * Verify: the visibility of the editor action bar
     *
     * @param isVisible whether the editor action bar is expected to be visible
     */
    async verifyIsVisible(isVisible) {
        await test_1.default.step(`Verify editor action bar is ${isVisible ? 'visible' : 'not visible'}`, async () => {
            isVisible
                ? await (0, test_1.expect)(this.actionBar).toBeVisible()
                : await (0, test_1.expect)(this.actionBar).not.toBeVisible();
        });
    }
}
exports.EditorActionBar = EditorActionBar;
//# sourceMappingURL=editorActionBar.js.map