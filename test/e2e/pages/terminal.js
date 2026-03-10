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
exports.Terminal = void 0;
const test_1 = __importStar(require("@playwright/test"));
const TERMINAL_WRAPPER = '#terminal .terminal-wrapper.active';
class Terminal {
    code;
    quickaccess;
    clipboard;
    terminalTab;
    constructor(code, quickaccess, clipboard) {
        this.code = code;
        this.quickaccess = quickaccess;
        this.clipboard = clipboard;
        this.terminalTab = this.code.driver.currentPage.getByRole('tab', { name: 'Terminal' }).locator('a');
    }
    async sendKeysToTerminal(key) {
        await this.code.driver.currentPage.keyboard.press(key);
    }
    async clickTerminalTab() {
        await this.terminalTab.click();
    }
    // Note, this doesn't work for Windows
    async waitForTerminalText(terminalText, options = {}) {
        const { timeout = 15000, expectedCount = 1 } = options;
        await (0, test_1.expect)(async () => {
            // since we are interacting with right click menus, don't poll too fast
            await this.code.wait(2000);
            if (process.platform !== 'darwin') {
                await this.handleContextMenu(this.code.driver.currentPage.locator(TERMINAL_WRAPPER), 'Select All');
            }
            else {
                await this.code.driver.currentPage.locator(TERMINAL_WRAPPER).click();
                await this.code.driver.currentPage.keyboard.press('Meta+A');
            }
            // wait a little between selection and copy
            await this.code.wait(1000);
            if (process.platform !== 'darwin') {
                await this.handleContextMenu(this.code.driver.currentPage.locator(TERMINAL_WRAPPER), 'Copy');
            }
            else {
                await this.code.driver.currentPage.keyboard.press('Meta+C');
            }
            const text = await this.clipboard.getClipboardText();
            // clean up regex text
            const safeTerminalText = terminalText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // allow case insensitive matches
            const matches = text.match(new RegExp(safeTerminalText, 'gi'));
            (0, test_1.expect)(matches?.length).toBe(expectedCount);
            return matches;
        }, 'Wait for terminal text').toPass({ timeout: timeout });
        return [];
    }
    async waitForTerminalLines() {
        await (0, test_1.expect)(async () => {
            const terminalLines = await this.code.driver.currentPage.locator(TERMINAL_WRAPPER).all();
            (0, test_1.expect)(terminalLines.length).toBeGreaterThan(0);
        }).toPass();
    }
    async createTerminal() {
        await this.quickaccess.runCommand('workbench.action.terminal.new');
        await this._waitForTerminal();
    }
    async _waitForTerminal() {
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.terminal.xterm.focus')).toBeVisible();
        await this.waitForTerminalLines();
    }
    async runCommandInTerminal(commandText) {
        await this.sendTextToTerminal(commandText);
        await this.code.driver.currentPage.locator(TERMINAL_WRAPPER).click();
        await this.code.driver.currentPage.keyboard.press('Enter');
    }
    async sendTextToTerminal(text) {
        const consoleInput = this.code.driver.currentPage.locator(TERMINAL_WRAPPER);
        await (0, test_1.expect)(consoleInput).toBeVisible();
        await consoleInput.evaluate(async (element, evalText) => {
            const xterm = element.xterm;
            if (xterm) {
                xterm.input(evalText);
            }
        }, text);
    }
    async logTerminalContents() {
        await test_1.default.step('Log terminal contents', async () => {
            const terminalRows = this.code.driver.currentPage.locator('.xterm-rows > div');
            const terminalContents = (await terminalRows.evaluateAll((rows) => rows.map((row) => {
                const spans = row.querySelectorAll('span');
                return Array.from(spans)
                    .map((span) => span.textContent?.trim() || '')
                    .join(' ');
            }))).filter((line) => line && line.length > 0)
                .join('\n');
            this.code.logger.log('---- START: Terminal Contents ----');
            this.code.logger.log(terminalContents);
            this.code.logger.log('---- END: Terminal Contents ----');
        });
    }
    /**
     * Right clicks and selects a menu item, waiting for menu dismissal.
     * @param locator Where to right click to get a context menu
     * @param action Which action to perform on the context menu
     */
    async handleContextMenu(locator, action) {
        try {
            await locator.click({ button: 'right', timeout: 2000 });
        }
        catch { }
        const menu = this.code.driver.currentPage.locator('.monaco-menu');
        // dismissing dialog can be erratic, allow retries
        for (let i = 0; i < 4; i++) {
            try {
                await menu.focus({ timeout: 2000 });
                await menu.locator(`[aria-label="${action}"]`).click({ timeout: 2000 });
                await (0, test_1.expect)(menu).toBeHidden({ timeout: 2000 });
                break;
            }
            catch {
            }
        }
    }
}
exports.Terminal = Terminal;
//# sourceMappingURL=terminal.js.map