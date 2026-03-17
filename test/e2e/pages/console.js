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
exports.Console = exports.ACTIVE_CONSOLE_INSTANCE = void 0;
const test_1 = __importStar(require("@playwright/test"));
const sessions_1 = require("./sessions");
const CONSOLE_INPUT = '.console-input';
exports.ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';
const MAXIMIZE_CONSOLE = '.bottom .codicon-positron-maximize-panel';
const HISTORY_COMPLETION_ITEM = '.history-completion-item';
const EMPTY_CONSOLE = '.positron-console .empty-console';
const INTERRUPT_RUNTIME = 'div.action-bar-button-face .codicon-positron-interrupt-runtime';
const SUGGESTION_LIST = '.suggest-widget .monaco-list-row';
const CONSOLE_LINES = `${exports.ACTIVE_CONSOLE_INSTANCE} div span`;
const ERROR = '.activity-error-message';
/*
 *  Reuseable Positron console functionality for tests to leverage.  Includes the ability to select an interpreter and execute code which
 *  aren't directly console functions, but rather features needed to support console testing.
 */
class Console {
    code;
    quickinput;
    hotKeys;
    contextMenu;
    restartButton;
    clearButton;
    trashButton;
    activeConsole;
    suggestionList;
    addSessionDuplicateButton;
    addSessionExpandMenuButton;
    consoleTab;
    error;
    get emptyConsole() {
        return this.code.driver.currentPage.locator(EMPTY_CONSOLE).getByText('There is no interpreter running');
    }
    constructor(code, quickinput, hotKeys, contextMenu) {
        this.code = code;
        this.quickinput = quickinput;
        this.hotKeys = hotKeys;
        this.contextMenu = contextMenu;
        // Standard Console Button Locators
        this.restartButton = this.code.driver.currentPage.getByTestId('restart-session');
        this.clearButton = this.code.driver.currentPage.getByLabel('Clear console');
        this.trashButton = this.code.driver.currentPage.getByTestId('trash-session');
        // `+` Add Session Split Button Locators
        this.addSessionDuplicateButton = this.code.driver.currentPage.getByLabel('Duplicate Active Console Session');
        this.addSessionExpandMenuButton = this.code.driver.currentPage.getByLabel('Quick Launch Session...');
        // Misc
        this.activeConsole = this.code.driver.currentPage.locator(exports.ACTIVE_CONSOLE_INSTANCE);
        this.suggestionList = this.code.driver.currentPage.locator(SUGGESTION_LIST);
        this.consoleTab = this.code.driver.currentPage.getByRole('tab', { name: 'Console', exact: true });
        this.error = this.code.driver.currentPage.locator(ERROR);
    }
    /**
     * Action: Start a new session via the `+ v` button in the console.
     *
     * @param contextMenu
     * @param runtime provided when option is 'Start New' to specify the runtime for the new session.
     */
    async clickStartAnotherSessionButton(runtime) {
        await test_1.default.step(`Expand \`+\` session button to start new session: ${runtime}`, async () => {
            await this.contextMenu.triggerAndClick({
                menuTrigger: this.addSessionExpandMenuButton,
                menuItemLabel: 'Start Another...'
            });
            await this.quickinput.waitForQuickInputOpened();
            await this.quickinput.type(sessions_1.availableRuntimes[runtime].name);
            await this.code.driver.currentPage.keyboard.press('Enter');
            await this.quickinput.waitForQuickInputClosed();
        });
    }
    /**
     * Action: Duplicate the active session via the `+` button in the console.
     */
    async clickDuplicateSessionButton() {
        await test_1.default.step(`Click \`+\` to duplicate session`, async () => {
            this.addSessionDuplicateButton.click();
        });
    }
    /**
     * Action: Create a single file via console
     */
    async createFile(runtime, fileName) {
        await test_1.default.step(`Create file via ${runtime}`, async () => {
            await this.focus();
            const code = runtime === 'Python'
                ? `open('${fileName}', 'w').write('hello')`
                : `file.create('${fileName}')`;
            await this.pasteCodeToConsole(code, true);
        });
    }
    /**
     * Verify: The session context menu contains the expected runtimes.
     *
     * @param contextMenu the context menu instance to use for interaction
     * @param runtimes the runtime names to expect in the context menu
     */
    async expectSessionContextMenuToContain(runtimes) {
        await test_1.default.step('Verify `+` menu contains runtime(s)', async () => {
            await this.contextMenu.triggerAndVerifyMenuItems({
                menuTrigger: this.addSessionExpandMenuButton,
                menuItemStates: runtimes
            });
        });
    }
    async executeCode(languageName, code, options) {
        return test_1.default.step(`Execute ${languageName} code in console: ${code}`, async () => {
            const timeout = options?.timeout ?? 30000;
            const waitForReady = options?.waitForReady ?? true;
            const maximizeConsole = options?.maximizeConsole ?? true;
            await (0, test_1.expect)(async () => {
                // Kind of hacky, but activate console in case focus was previously lost
                await this.focus();
                await this.hotKeys.executeCodeInConsole();
                await this.quickinput.waitForQuickInputOpened();
                await this.quickinput.type(languageName);
                await this.quickinput.waitForQuickInputElements(e => e.length === 1 && e[0] === languageName);
                await this.code.driver.currentPage.keyboard.press('Enter');
                await this.quickinput.waitForQuickInputOpened();
                const unescapedCode = code
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r');
                await this.quickinput.type(unescapedCode);
                await this.code.driver.currentPage.keyboard.press('Enter');
                await this.quickinput.waitForQuickInputClosed();
            }).toPass();
            if (waitForReady) {
                await this.waitForReady(languageName === 'Python' ? '>>>' : '>', timeout);
            }
            if (maximizeConsole) {
                await this.maximizeConsole();
            }
        });
    }
    async logConsoleContents() {
        await test_1.default.step('Log console contents', async () => {
            this.code.logger.log('---- START: Console Contents ----');
            const contents = await this.code.driver.currentPage.locator(CONSOLE_LINES).allTextContents();
            contents.forEach(line => this.code.logger.log(line));
            this.code.logger.log('---- END: Console Contents ----');
        });
    }
    async typeToConsole(text, pressEnter = false, delay = 10) {
        await test_1.default.step(`Type to console: ${text}`, async () => {
            await this.code.driver.currentPage.waitForTimeout(500);
            await this.activeConsole.click();
            await this.code.driver.currentPage.keyboard.type(text, { delay });
            if (pressEnter) {
                await this.code.driver.currentPage.waitForTimeout(1000);
                await this.code.driver.currentPage.keyboard.press('Enter');
            }
        });
    }
    async clearInput() {
        await test_1.default.step('Clear console input', async () => {
            await this.focus();
            await this.hotKeys.selectAll();
            await this.code.driver.currentPage.keyboard.press('Backspace');
        });
    }
    async sendEnterKey() {
        await test_1.default.step('Send Enter key to console', async () => {
            await this.focus();
            await this.code.driver.currentPage.waitForTimeout(500);
            await this.code.driver.currentPage.keyboard.press('Enter');
        });
    }
    async waitForReady(prompt, timeout = 30000) {
        const activeLine = this.code.driver.currentPage.locator(`${exports.ACTIVE_CONSOLE_INSTANCE} .active-line-number`);
        await (0, test_1.expect)(activeLine).toHaveText(prompt, { timeout });
    }
    async waitForReadyAndStarted(prompt, timeout = 30000, expectedCount = 1) {
        await test_1.default.step('Wait for console to be ready and started', async () => {
            await this.waitForReady(prompt, timeout);
            await this.waitForConsoleContents('started', { timeout, expectedCount });
        });
    }
    async waitForReadyAndRestarted(prompt, timeout = 30000) {
        await test_1.default.step('Wait for console to be ready and restarted', async () => {
            await this.waitForReady(prompt, timeout);
            await this.waitForConsoleContents('restarted', { timeout });
        });
    }
    async doubleClickConsoleText(text) {
        await this.code.driver.currentPage.locator(CONSOLE_LINES).getByText(text).dblclick();
    }
    async waitForConsoleContents(consoleTextOrRegex, options = {}) {
        return await test_1.default.step(`Verify console contains: ${consoleTextOrRegex}`, async () => {
            const { timeout = 15000, expectedCount = 1, exact = false } = options;
            if (expectedCount === 0) {
                const startTime = Date.now();
                while (Date.now() - startTime < timeout) {
                    const errorMessage = `Expected text "${consoleTextOrRegex}" to not appear, but it did.`;
                    try {
                        const matchingLines = this.code.driver.currentPage.locator(CONSOLE_LINES).getByText(consoleTextOrRegex);
                        const count = await matchingLines.count();
                        if (count > 0) {
                            throw new Error(errorMessage); // Fail the test immediately
                        }
                    }
                    catch (error) {
                        if (error instanceof Error && error.message.includes(errorMessage)) {
                            throw error;
                        }
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                return [];
            }
            // Normal case: waiting for `expectedCount` occurrences
            const matchingLines = this.code.driver.currentPage.locator(CONSOLE_LINES).getByText(consoleTextOrRegex, { exact });
            await (0, test_1.expect)(matchingLines).toHaveCount(expectedCount, { timeout });
            return expectedCount ? matchingLines.allTextContents() : [];
        });
    }
    async waitForCurrentConsoleLineContents(expectedText, timeout = 30000) {
        const locator = this.code.driver.currentPage.locator(`${exports.ACTIVE_CONSOLE_INSTANCE} .view-line`);
        await (0, test_1.expect)(locator).toContainText(expectedText, { timeout });
        return await locator.textContent() ?? '';
    }
    async waitForConsoleExecution({ timeout = 20000 } = {}) {
        await (0, test_1.expect)(this.code.driver.currentPage.getByLabel('Interrupt execution')).not.toBeVisible({ timeout });
    }
    async waitForHistoryContents(expectedText, count = 1, timeout = 30000) {
        const historyItem = this.code.driver.currentPage.locator(HISTORY_COMPLETION_ITEM);
        await (0, test_1.expect)(historyItem.filter({ hasText: expectedText })).toHaveCount(count, { timeout });
        return await historyItem.allTextContents();
    }
    async maximizeConsole() {
        await this.code.driver.currentPage.locator(MAXIMIZE_CONSOLE).click();
    }
    async sendInterrupt() {
        await this.hotKeys.sendInterrupt();
    }
    async pasteCodeToConsole(code, sendEnterKey = false) {
        await test_1.default.step(`Paste code to console: ${code}`, async () => {
            const consoleInput = this.activeConsole.locator(CONSOLE_INPUT);
            await this.pasteInMonaco(consoleInput, code);
            if (sendEnterKey) {
                await (0, test_1.expect)(this.code.driver.currentPage.getByLabel('Interrupt execution')).not.toBeVisible();
                await this.sendEnterKey();
            }
        });
    }
    async pasteInMonaco(locator, text, maxRetries = 3) {
        const editContext = locator.locator('.native-edit-context');
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // Attempt paste
            await editContext.evaluate(async (element, evalText) => {
                const clipboardData = new DataTransfer();
                clipboardData.setData('text/plain', evalText);
                const clipboardEvent = new ClipboardEvent('paste', {
                    clipboardData,
                });
                element.dispatchEvent(clipboardEvent);
            }, text);
            // Allow time for paste to register
            await locator.page().waitForTimeout(100);
            function normalize(text) {
                return text
                    .normalize('NFKC') // Normalize Unicode (optional but good when working with special chars)
                    .replace(/\s+/g, '') // Remove all whitespace
                    .replace(/\u00a0/g, '') // Remove non-breaking spaces
                    .replace(/[^\x20-\x7E]/g, '') // Remove not printable ASCII
                    .trim();
            }
            const visibleText = await locator.evaluate(el => el.textContent || '');
            if (normalize(visibleText).includes(normalize(text))) {
                return; // Paste succeeded
            }
            if (attempt < maxRetries) {
                await locator.page().waitForTimeout(100);
            }
            else {
                throw new Error('Paste failed after multiple retries');
            }
        }
    }
    getLastClickableLink() {
        return this.activeConsole.locator('.output-run-hyperlink').last();
    }
    async waitForExecutionStarted(timeout = 30000) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(INTERRUPT_RUNTIME)).toBeVisible({ timeout });
    }
    async waitForExecutionComplete(timeout = 30000) {
        await (0, test_1.expect)(this.code.driver.currentPage.locator(INTERRUPT_RUNTIME)).toBeHidden({ timeout });
    }
    async focus() {
        await this.hotKeys.focusConsole();
    }
    async clickConsoleTab() {
        // sometimes the click doesn't work (or happens too fast), so adding a retry
        await (0, test_1.expect)(async () => {
            const consoleInput = this.code.driver.currentPage.locator('div.console-input').first();
            if (!await consoleInput.isVisible()) {
                await this.consoleTab.click();
            }
            (0, test_1.expect)(await consoleInput.count()).toBeGreaterThan(0);
        }).toPass({ timeout: 10000 });
    }
    async interruptExecution() {
        await this.code.driver.currentPage.getByLabel('Interrupt execution').click();
    }
    async expectSuggestionListCount(count) {
        await test_1.default.step(`Expect console suggestion list count to be ${count}`, async () => {
            await (0, test_1.expect)(this.suggestionList).toHaveCount(count, { timeout: 15000 });
        });
    }
    async expectSuggestionListToContain(label) {
        await test_1.default.step(`Expect console suggestion list to contain: ${label}`, async () => {
            await this.code.driver.currentPage.locator('.suggest-widget').getByLabel(label).isVisible();
        });
    }
    async expectConsoleToContainError(error) {
        await test_1.default.step(`Expect console to contain error: ${error}`, async () => {
            await (0, test_1.expect)(this.error).toContainText(error);
        });
    }
}
exports.Console = Console;
//# sourceMappingURL=console.js.map