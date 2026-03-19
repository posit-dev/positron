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
exports.Viewer = void 0;
const test_1 = __importStar(require("@playwright/test"));
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REFRESH_BUTTON = '.codicon-positron-refresh';
const VIEWER_PANEL = '[id="workbench.panel.positronPreview"]';
const ACTION_BAR = '.positron-action-bar';
const FULL_APP = 'body';
class Viewer {
    code;
    get fullApp() { return this.code.driver.currentPage.locator(FULL_APP); }
    get viewerFrame() { return this.code.driver.currentPage.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME); }
    get interruptButton() { return this.code.driver.currentPage.locator(ACTION_BAR).getByRole('button', { name: 'Interrupt execution' }); }
    constructor(code) {
        this.code = code;
    }
    getViewerLocator(locator) {
        return this.viewerFrame.locator(locator);
    }
    getViewerFrame() {
        return this.viewerFrame;
    }
    async refreshViewer() {
        await this.code.driver.currentPage.locator(REFRESH_BUTTON).click({ timeout: 15000 });
    }
    async clearViewer() {
        await this.code.driver.currentPage.getByRole('tab', { name: 'Viewer' }).locator('a').click();
        const clearRegex = /Clear the/;
        if (await this.fullApp.getByLabel(clearRegex).isVisible()) {
            await this.fullApp.getByLabel(clearRegex).click();
            await this.expectContentNotVisible(() => this.fullApp.getByLabel(clearRegex), 10000);
        }
    }
    async openViewerToEditor() {
        await this.code.driver.currentPage.locator('.codicon-go-to-file').click();
    }
    async expectViewerPanelVisible(timeout = 10000) {
        await test_1.default.step('Expect viewer panel visible', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(VIEWER_PANEL)).toBeVisible({ timeout });
        });
    }
    async expectUrlToHaveValue(expectedUrl, timeout = 10000) {
        await test_1.default.step(`Expect viewer URL to have value: ${expectedUrl}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.getByRole('textbox', { name: 'The current URL' })).toHaveValue(expectedUrl, { timeout });
        });
    }
    /**
     * Wait for content to be visible in the viewer frame, with retry on failure.
     *
     * Dev servers (Flask, Dash, etc.) may report "running" before actually accepting
     * connections, causing ERR_CONNECTION_RESET. If content isn't visible, the onRetry
     * callback is called to allow restarting the server before the next attempt.
     *
     * @param useIframe - Set to false for Positron output (great-tables, modelsummary) that renders directly.
     *                    Defaults to true for web apps (Flask, Dash) that render in an iframe.
     */
    async expectContentVisible(getLocator, options) {
        const { timeout = 60000, onRetry, useIframe = undefined } = options ?? {};
        await test_1.default.step('Expect content visible in viewer frame', async () => {
            await (0, test_1.expect)(async () => {
                // Get the frame and locator for the content
                const frame = useIframe === undefined
                    ? !this.code.electronApp
                        ? this.viewerFrame.frameLocator('iframe')
                        : this.getViewerFrame()
                    : useIframe
                        ? this.viewerFrame.frameLocator('iframe')
                        : this.getViewerFrame();
                const locator = getLocator(frame);
                // Check if content is visible
                let isVisible = false;
                try {
                    isVisible = await locator.isVisible();
                }
                catch {
                    // Frame might not be accessible after ERR_CONNECTION_RESET
                }
                // If content isn't visible, call onRetry to allow restarting the server
                if (!isVisible && onRetry) {
                    await onRetry();
                }
                // Expect the content to be visible
                await (0, test_1.expect)(locator).toBeVisible({ timeout: 5000 });
            }).toPass({ timeout });
        });
    }
    async expectContentNotVisible(getLocator, timeout = 10000) {
        await test_1.default.step('Expect content not visible in viewer frame', async () => {
            await (0, test_1.expect)(async () => {
                const frame = this.getViewerFrame();
                const locator = getLocator(frame);
                await (0, test_1.expect)(locator).not.toBeVisible({ timeout: 5000 });
            }).toPass({ timeout });
        });
    }
}
exports.Viewer = Viewer;
//# sourceMappingURL=viewer.js.map