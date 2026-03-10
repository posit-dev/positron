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
exports.Output = void 0;
const os = __importStar(require("os"));
const OUTPUT_LINE = '.view-line';
const OUTPUT_PANE = 'div[id="workbench.panel.output"]';
/*
 *  Reuseable Positron output functionality for tests to leverage.
 */
class Output {
    code;
    quickaccess;
    quickinput;
    constructor(code, quickaccess, quickinput) {
        this.code = code;
        this.quickaccess = quickaccess;
        this.quickinput = quickinput;
    }
    async openOutputPane(outputPaneNameContains) {
        await this.quickaccess.runCommand('workbench.action.showOutputChannels', { keepOpen: true });
        await this.quickinput.waitForQuickInputOpened();
        await this.quickinput.type(outputPaneNameContains);
        await this.quickinput.selectQuickInputElementContaining(outputPaneNameContains);
        await this.quickinput.waitForQuickInputClosed();
    }
    async clickOutputTab() {
        await this.code.driver.currentPage.getByRole('tab', { name: 'Output' }).locator('a').click();
    }
    async waitForOutContaining(fragment) {
        const outputPane = this.code.driver.currentPage.locator(OUTPUT_PANE);
        const outputLine = outputPane.locator(OUTPUT_LINE);
        await outputLine.getByText(fragment).first().isVisible();
    }
    /**
     * Scroll to the top of the output pane
     */
    async scrollToTop() {
        // First, ensure the output pane is focused
        await this.quickaccess.runCommand('workbench.panel.output.focus');
        // Use platform-specific keyboard shortcuts to scroll to top
        const platform = os.platform();
        if (platform === 'darwin') {
            // On macOS, use Cmd+ArrowUp
            await this.code.driver.currentPage.keyboard.press('Meta+ArrowUp');
        }
        else {
            // On Windows/Linux, use Ctrl+Home
            await this.code.driver.currentPage.keyboard.press('Control+Home');
        }
    }
    /**
     * Copy selected text from the output pane and return it
     */
    async copySelectedText() {
        const isMac = os.platform() === 'darwin';
        const modifier = isMac ? 'Meta' : 'Control';
        await this.code.driver.currentPage.keyboard.press(`${modifier}+C`);
        // Wait a bit for the copy operation to complete
        await this.code.driver.currentPage.waitForTimeout(100);
        // Grant permissions to read from clipboard
        await this.code.driver.browserContext.grantPermissions(['clipboard-read']);
        // Read the clipboard content
        const clipboardText = await this.code.driver.currentPage.evaluate(async () => {
            try {
                return await navigator.clipboard.readText();
            }
            catch (error) {
                console.error('Failed to read clipboard text:', error);
                return '';
            }
        });
        return clipboardText;
    }
    /**
     * Select the first N lines of output text
     */
    async selectFirstNLines(lineCount) {
        const outputPane = this.code.driver.currentPage.locator(OUTPUT_PANE);
        const outputLines = outputPane.locator('.view-line');
        const totalLines = await outputLines.count();
        if (totalLines === 0) {
            throw new Error('No output lines found in the output pane');
        }
        // Calculate how many lines to select (or all lines if less than N)
        const linesToSelect = Math.min(lineCount, totalLines);
        const endLineIndex = linesToSelect - 1;
        // Click on the first line and then shift+click on the last line of selection
        const startLine = outputLines.nth(0);
        const endLine = outputLines.nth(endLineIndex);
        await startLine.click();
        await endLine.click({ modifiers: ['Shift'] });
    }
}
exports.Output = Output;
//# sourceMappingURL=output.js.map