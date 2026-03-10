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
exports.Debug = void 0;
const test_1 = __importStar(require("@playwright/test"));
const DEBUG_TOOLBAR = '.debug-toolbar';
const GLYPH_AREA = '.margin-view-overlays>:nth-child';
const BREAKPOINT_GLYPH = '.monaco-editor .codicon-debug-breakpoint';
const BREAKPOINT_GLYPH_UNVERIFIED = '.monaco-editor .codicon-debug-breakpoint-unverified';
const STOP = `.debug-toolbar .action-label[aria-label*="Stop"]`;
const VIEWLET = 'div[id="workbench.view.debug"]';
const VARIABLE = `${VIEWLET} .debug-variables .monaco-list-row .expression`;
const STEP_OVER = `.debug-toolbar .action-label[aria-label*="Step Over"]`;
const STEP_INTO = `.debug-toolbar .action-label[aria-label*="Step Into"]`;
const CONTINUE = `.debug-toolbar .action-label[aria-label*="Continue"]`;
const STEP_OUT = `.debug-toolbar .action-label[aria-label*="Step Out"]`;
const STACK_FRAME = `${VIEWLET} .monaco-list-row .stack-frame`;
const DEBUG_CALL_STACK = '.debug-call-stack';
/*
 *  Reuseable Positron debug functionality for tests to leverage
 */
class Debug {
    code;
    hotKeys;
    quickaccess;
    get debugVariablesSection() { return this.code.driver.currentPage.getByRole('button', { name: 'Debug Variables Section' }); }
    get callStackSection() { return this.code.driver.currentPage.getByRole('button', { name: 'Call Stack Section' }); }
    get callStack() { return this.code.driver.currentPage.locator(DEBUG_CALL_STACK); }
    stackAtIndex = (index) => this.callStack.locator(`.monaco-list-row[data-index="${index}"]`);
    debugPane;
    debugToolbar;
    constructor(code, hotKeys, quickaccess) {
        this.code = code;
        this.hotKeys = hotKeys;
        this.quickaccess = quickaccess;
        this.debugPane = this.code.driver.currentPage.locator('.debug-pane');
        this.debugToolbar = this.code.driver.currentPage.locator(DEBUG_TOOLBAR);
    }
    async setBreakpointOnLine(lineNumber, index = 0) {
        await test_1.default.step(`Debug: Set breakpoint on line ${lineNumber}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(`${GLYPH_AREA}(${lineNumber})`)).toBeVisible();
            await this.code.driver.currentPage.locator(`${GLYPH_AREA}(${lineNumber})`).click({ position: { x: 5, y: 5 }, force: true });
            await (0, test_1.expect)(this.code.driver.currentPage.locator(BREAKPOINT_GLYPH).nth(index)).toBeVisible();
        });
    }
    /**
     * Action: Set a breakpoint on a line and expect it to be initially unverified (gray)
     *
     * @param lineNumber The line number to set the breakpoint on
     * @param index The index of the breakpoint if multiple exist (default 0)
     */
    async setUnverifiedBreakpointOnLine(lineNumber, index = 0) {
        await test_1.default.step(`Debug: Set unverified breakpoint on line ${lineNumber}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(`${GLYPH_AREA}(${lineNumber})`)).toBeVisible();
            await this.code.driver.currentPage.locator(`${GLYPH_AREA}(${lineNumber})`).click({ position: { x: 5, y: 5 }, force: true });
            // For R breakpoints, initially expect the breakpoint to be unverified (gray)
            await (0, test_1.expect)(this.code.driver.currentPage.locator(BREAKPOINT_GLYPH_UNVERIFIED).nth(index)
                .or(this.code.driver.currentPage.locator(BREAKPOINT_GLYPH).nth(index))).toBeVisible();
        });
    }
    /**
     * Verify: Wait for breakpoint to become verified (red)
     *
     * @param index The index of the breakpoint to check (default 0)
     * @param timeout Maximum time to wait for verification (default 30000ms)
     */
    async expectBreakpointVerified(index = 0, timeout = 30000) {
        await test_1.default.step(`Verify breakpoint ${index} is verified (red)`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(BREAKPOINT_GLYPH).nth(index)).toBeVisible({ timeout });
        });
    }
    /**
     * Verify: Breakpoint is currently unverified (gray)
     *
     * @param index The index of the breakpoint to check (default 0)
     */
    async expectBreakpointUnverified(index = 0) {
        await test_1.default.step(`Verify breakpoint ${index} is unverified (gray)`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(BREAKPOINT_GLYPH_UNVERIFIED).nth(index)).toBeVisible();
        });
    }
    async clearBreakpoints() {
        await this.hotKeys.clearAllBreakpoints();
    }
    async unSetBreakpointOnLine(lineNumber, index = 0) {
        await test_1.default.step(`Debug: Unset breakpoint on line ${lineNumber}`, async () => {
            await this.code.driver.currentPage.locator(BREAKPOINT_GLYPH).nth(index).click({ position: { x: 5, y: 5 } });
            await this.code.driver.currentPage.mouse.move(50, 50);
        });
    }
    async startDebugging() {
        await test_1.default.step('Debug: Start', async () => {
            await this.code.driver.currentPage.keyboard.press('F5');
            await (0, test_1.expect)(this.code.driver.currentPage.locator(STOP)).toBeVisible();
        });
    }
    async debugCell() {
        await test_1.default.step('Debug notebook', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.positron-variables-container').locator('text=No Variables have been created')).toBeVisible({ timeout: 20000 });
            // Prefer to use hotkey but there is an issue with yellow marker not showing
            // await this.hotKeys.debugCell();
            await this.quickaccess.runCommand('notebook.debugCell');
            await this.expectCurrentLineIndicatorVisible();
        });
    }
    async getVariables() {
        const variableLocators = await this.code.driver.currentPage.locator(VARIABLE).all();
        const variables = [];
        for (const variable of variableLocators) {
            const text = await variable.textContent();
            if (text !== null) {
                variables.push(text);
            }
        }
        return variables;
    }
    async expectVariablesToExist(variables) {
        for (const variable of variables) {
            await test_1.default.step(`Verify variable exists: ${variable.label} with value: ${variable.value}`, async () => {
                await (0, test_1.expect)(this.debugPane.getByText(`${variable.label} =${variable.value}`)).toBeVisible();
            });
        }
    }
    async stepOver() {
        await test_1.default.step('Debug: Step over', async () => {
            await this.code.driver.currentPage.locator(STEP_OVER).click();
        });
    }
    async stepInto() {
        await test_1.default.step('Debug: Step into', async () => {
            await this.code.driver.currentPage.locator(STEP_INTO).click();
        });
    }
    async stepOut() {
        await test_1.default.step('Debug: Step out', async () => {
            await this.code.driver.currentPage.locator(STEP_OUT).click();
        });
    }
    async continue() {
        await test_1.default.step('Debug: Continue', async () => {
            await this.code.driver.currentPage.locator(CONTINUE).click();
        });
    }
    async getStack() {
        const stackLocators = await this.code.driver.currentPage.locator(STACK_FRAME).all();
        const stack = [];
        for (const stackLocator of stackLocators) {
            const name = await stackLocator.locator('.file-name').textContent();
            const lineNumberRaw = await stackLocator.locator('.line-number').textContent();
            const lineNumber = lineNumberRaw ? parseInt(lineNumberRaw.split(':').shift() || '0', 10) : 0;
            stack.push({ name: name || '', lineNumber: lineNumber });
        }
        return stack;
    }
    /**
     * Action: select item in the call stack at the specified index
     *
     * @param stackPosition An index in the call stack to select
     */
    async selectCallStackAtIndex(stackPosition) {
        await test_1.default.step(`Debug: Select call stack at index ${stackPosition}`, async () => {
            await this.stackAtIndex(stackPosition).click();
        });
    }
    /**
     * Verify: The debug pane is visible and contains the specified variable
     *
     * @param variableLabel The label of the variable to check in the debug pane
     */
    async expectDebugPaneToContain(variableLabel) {
        await test_1.default.step(`Verify debug pane contains: ${variableLabel}`, async () => {
            await (0, test_1.expect)(this.debugVariablesSection).toBeVisible();
            await (0, test_1.expect)(this.code.driver.currentPage.getByLabel(variableLabel)).toBeVisible();
        });
    }
    /**
     * Verify: The debug toolbar is visible
     */
    async expectDebugToolbarVisible() {
        await test_1.default.step('Verify debug toolbar is visible', async () => {
            await (0, test_1.expect)(this.debugToolbar).toBeVisible();
        });
    }
    /**
     * Verify: The debug variable pane is visible
     */
    async expectDebugVariablePaneVisible() {
        await test_1.default.step('Verify debug variable pane is visible', async () => {
            await (0, test_1.expect)(this.debugVariablesSection).toBeVisible();
        });
    }
    /**
     * Verify: The call stack is visible and contains the specified item at the specified position
     *
     * @param stackPosition The expected position (data-index) of the item in the call stack
     * @param item The item to check in the call stack
     *
     */
    async expectCallStackAtIndex(stackPosition, item) {
        await test_1.default.step(`Verify call stack at index {${stackPosition}}: ${item}`, async () => {
            await (0, test_1.expect)(this.callStackSection).toBeVisible();
            await (0, test_1.expect)(this.stackAtIndex(stackPosition)).toContainText(item);
        });
    }
    /**
     * Verify: In browser mode at the specified frame
     *
     * @param number The frame number to check in the browser mode
     */
    async expectBrowserModeFrame(number) {
        await test_1.default.step(`Verify in browser mode: frame ${number}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.getByText(`Browse[${number}]>`)).toBeVisible();
        });
    }
    /**
     * Verify: the current line is the specified line number
     *
     * @param lineNumber
     */
    async expectCurrentLineToBe(lineNumber) {
        await test_1.default.step(`Verify current line is: ${lineNumber}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('[id="workbench.parts.editor"]').locator('.line-numbers.active-line-number')).toHaveText(lineNumber.toString());
        });
    }
    /**
     * Verify: the current line indicator is visible
     * Note: This does not check the line number, only that the indicator is present
     */
    async expectCurrentLineIndicatorVisible(timeout = 15000) {
        await test_1.default.step('Verify current line indicator is visible', async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.codicon-debug-stackframe')).toBeVisible({ timeout: timeout });
        });
    }
}
exports.Debug = Debug;
//# sourceMappingURL=debug.js.map