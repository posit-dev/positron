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
exports.Notebooks = void 0;
const path_1 = require("path");
const test_1 = __importStar(require("@playwright/test"));
const KERNEL_DROPDOWN = 'a.kernel-label';
const KERNEL_LABEL = '.codicon-notebook-kernel-select';
const DETECTING_KERNELS_TEXT = 'Detecting Kernels';
const NEW_NOTEBOOK_COMMAND = 'ipynb.newUntitledIpynb';
const CELL_LINE = '.cell div.view-lines';
const EXECUTE_CELL_COMMAND = 'notebook.cell.execute';
const EXECUTE_CELL_SPINNER = '.codicon-notebook-state-executing';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REVERT_AND_CLOSE = 'workbench.action.revertAndCloseActiveEditor';
const MARKDOWN_TEXT = '#preview';
const ACTIVE_ROW_SELECTOR = `.notebook-editor .monaco-list-row.focused`;
/*
 * Shared Notebooks functionality for both Vscode and Positron notebooks.
 */
class Notebooks {
    code;
    quickinput;
    quickaccess;
    hotKeys;
    kernelLabel;
    kernelDropdown;
    frameLocator;
    notebookProgressBar;
    cellIndex;
    interruptButton;
    constructor(code, quickinput, quickaccess, hotKeys) {
        this.code = code;
        this.quickinput = quickinput;
        this.quickaccess = quickaccess;
        this.hotKeys = hotKeys;
        this.kernelLabel = this.code.driver.currentPage.locator(KERNEL_LABEL);
        this.kernelDropdown = this.code.driver.currentPage.locator(KERNEL_DROPDOWN);
        this.frameLocator = this.code.driver.currentPage.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
        this.notebookProgressBar = this.code.driver.currentPage.locator('[id="workbench\\.parts\\.editor"]').getByRole('progressbar');
        this.cellIndex = (num = 0) => this.code.driver.currentPage.locator('.cell-inner-container > .cell').nth(num);
        this.interruptButton = this.code.driver.currentPage.getByRole('button', { name: 'Interrupt' });
    }
    async selectInterpreter(kernelGroup, desiredKernel = kernelGroup === 'Python'
        ? process.env.POSITRON_PY_VER_SEL
        : process.env.POSITRON_R_VER_SEL) {
        await test_1.default.step(`Select kernel: ${desiredKernel}`, async () => {
            await (0, test_1.expect)(this.notebookProgressBar).not.toBeVisible({ timeout: 30000 });
            await (0, test_1.expect)(this.code.driver.currentPage.locator(DETECTING_KERNELS_TEXT)).not.toBeVisible({ timeout: 30000 });
            await (0, test_1.expect)(this.code.driver.currentPage.locator(EXECUTE_CELL_SPINNER)).not.toBeVisible({ timeout: 30000 });
            try {
                // 1. Try finding by text
                await (0, test_1.expect)(this.kernelDropdown.filter({ hasText: desiredKernel })).toBeVisible({ timeout: 2500 });
                this.code.logger.log(`Kernel: found by text: ${desiredKernel}`);
                return;
            }
            catch (e) {
                this.code.logger.log(`Kernel: not found by text: ${desiredKernel}`);
            }
            try {
                // 2. Try finding by label
                const kernelLabelLocator = this.code.driver.currentPage.locator(KERNEL_LABEL);
                await (0, test_1.expect)(kernelLabelLocator).toHaveAttribute('aria-label', new RegExp(desiredKernel), { timeout: 2500 });
                this.code.logger.log(`Kernel: found by label: ${desiredKernel}`);
                return;
            }
            catch (e) {
                this.code.logger.log(`Kernel: not found by label: ${desiredKernel}`);
            }
            // 3. Open dropdown to select kernel
            this.code.logger.log(`Kernel: opening dropdown to select: ${desiredKernel}`);
            await this.code.driver.currentPage.locator(KERNEL_DROPDOWN).click();
            await this.quickinput.waitForQuickInputOpened();
            await this.code.driver.currentPage.getByText('Select Environment...').click();
            await this.quickinput.type(desiredKernel);
            await this.quickinput.selectQuickInputElementContaining(`${kernelGroup} ${desiredKernel}`);
            await this.quickinput.waitForQuickInputClosed();
            // Wait for kernel initialization
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.kernel-action-view-item .codicon-modifier-spin')).not.toBeVisible({ timeout: 30000 });
        });
    }
    async expectKernelToBe(kernelName) {
        await test_1.default.step(`Expect kernel to be: ${kernelName}`, async () => {
            await (0, test_1.expect)(this.kernelDropdown).toHaveText(new RegExp(escapeRegExp(kernelName), 'i'), { timeout: 30000 });
        });
    }
    async createNewNotebook() {
        await this.quickaccess.runCommand(NEW_NOTEBOOK_COMMAND);
    }
    // Opens a Notebook that lives in the current workspace
    async openNotebook(path) {
        await test_1.default.step(`Open notebook: ${path}`, async () => {
            await this.quickaccess.openFileQuickAccessAndWait((0, path_1.basename)(path), 1);
            await this.quickinput.selectQuickInputElement(0);
            await (0, test_1.expect)(this.code.driver.currentPage.locator('.cell').first()).toBeVisible({ timeout: 60000 });
            await (0, test_1.expect)(this.code.driver.currentPage.getByText('Detecting Kernels')).not.toBeVisible({ timeout: 30000 });
            await this.focusFirstCell();
        });
    }
    async addCodeToCellAtIndex(cellIndex, code, delay = 0) {
        await test_1.default.step('Add code to first cell', async () => {
            await this.selectCellAtIndex(cellIndex);
            await this.typeInEditor(code, delay);
        });
    }
    async hoverCellText(cellIndex, text) {
        await test_1.default.step(`Hover cell ${cellIndex} text: "${text}"`, async () => {
            const cellText = this.code.driver.currentPage.locator(CELL_LINE).nth(cellIndex).locator('span').locator('span').filter({ hasText: text });
            await cellText.click();
            await cellText.hover();
        });
    }
    async executeCodeInCell() {
        await test_1.default.step('Execute code in cell', async () => {
            await this.quickaccess.runCommand(EXECUTE_CELL_COMMAND);
            await (0, test_1.expect)(this.code.driver.currentPage.locator(EXECUTE_CELL_SPINNER), 'execute cell spinner to not be visible').toHaveCount(0, { timeout: 30000 });
        });
    }
    async assertCellOutput(text, cellIndex, { timeout = 15000 } = {}) {
        if (cellIndex !== undefined) {
            // Target specific cell output
            const cellOutput = this.frameLocator.locator('.output_container').nth(cellIndex);
            await (0, test_1.expect)(cellOutput.getByText(text)).toBeVisible({ timeout });
        }
        else {
            // Use nth(0) to get the first occurrence when multiple elements exist
            await (0, test_1.expect)(this.frameLocator.getByText(text).nth(0)).toBeVisible({ timeout });
        }
    }
    async closeNotebookWithoutSaving() {
        await this.quickaccess.runCommand(REVERT_AND_CLOSE);
    }
    async expectMarkdownTagToBe(tag, expectedText) {
        const markdownLocator = this.frameLocator.locator(`${MARKDOWN_TEXT} ${tag}`);
        await (0, test_1.expect)(markdownLocator).toBeVisible();
        await (0, test_1.expect)(markdownLocator).toHaveText(expectedText);
    }
    async runAllCells({ timeout = 15000 } = {}) {
        await test_1.default.step('Run all cells', async () => {
            await this.code.driver.currentPage.getByLabel('Run All').click();
            const stopExecutionLocator = this.code.driver.currentPage.locator('a').filter({ hasText: /Stop Execution|Interrupt/ });
            try {
                await (0, test_1.expect)(stopExecutionLocator).toBeVisible({ timeout });
                await (0, test_1.expect)(stopExecutionLocator).not.toBeVisible({ timeout });
            }
            catch { } // can be normal with very fast execution
        });
    }
    async focusFirstCell() {
        await this.quickaccess.runCommand('notebook.focusTop');
    }
    async deleteAllCells() {
        const cellCount = await this.code.driver.currentPage.locator('.cell-inner-container > .cell').count();
        for (let i = cellCount; i > 0; i--) {
            await this.cellIndex(i - 1).click();
            await this.code.driver.currentPage.getByRole('button', { name: 'Delete Cell' }).click();
        }
    }
    async typeInEditor(text, delay = 0) {
        await test_1.default.step(`Type in editor: ${text}`, async () => {
            const editor = `${ACTIVE_ROW_SELECTOR} .monaco-editor`;
            await this.code.driver.currentPage.locator(editor).isVisible();
            const editContext = `${editor} .native-edit-context`;
            await (0, test_1.expect)(this.code.driver.currentPage.locator(editContext)).toBeFocused();
            await this.code.driver.currentPage.locator(editContext).pressSequentially(text, { delay });
        });
    }
    async _waitForActiveCellEditorContents(accept) {
        const selector = `${ACTIVE_ROW_SELECTOR} .monaco-editor .view-lines`;
        const locator = this.code.driver.currentPage.locator(selector);
        let content = '';
        await (0, test_1.expect)(async () => {
            content = (await locator.textContent())?.replace(/\u00a0/g, ' ') || '';
            if (!accept(content)) {
                throw new Error(`Content did not match condition: ${content}`);
            }
        }).toPass();
        return content;
    }
    async waitForActiveCellEditorContents(contents) {
        return this._waitForActiveCellEditorContents(content => content === contents);
    }
    async insertNotebookCell(kind) {
        await (0, test_1.expect)(async () => {
            if (kind === 'markdown') {
                await this.quickaccess.runCommand('notebook.cell.insertMarkdownCellBelow');
            }
            else {
                await this.quickaccess.runCommand('notebook.cell.insertCodeCellBelow');
            }
        }).toPass({ timeout: 60000 });
    }
    async selectCellAtIndex(cellIndex) {
        await test_1.default.step(`Select cell at index: ${cellIndex}`, async () => {
            if (cellIndex === 0) {
                for (let i = 0; i < 5; i++) {
                    await this.code.driver.currentPage.keyboard.press('ArrowUp');
                }
            }
            await this.code.driver.currentPage.locator(CELL_LINE).nth(cellIndex).click();
        });
    }
    async stopEditingCell() {
        await this.quickaccess.runCommand('notebook.cell.quitEdit');
    }
    async executeActiveCell() {
        await this.hotKeys.executeNotebookCell();
        await (0, test_1.expect)(this.code.driver.currentPage.getByRole('button', { name: 'Go To' })).not.toBeVisible({ timeout: 30000 });
    }
}
exports.Notebooks = Notebooks;
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=notebooks.js.map