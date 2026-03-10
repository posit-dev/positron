"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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
exports.InlineQuarto = void 0;
const test_1 = __importStar(require("@playwright/test"));
// --- Selectors ---
const KERNEL_STATUS_WIDGET = '[data-testid="quarto-kernel-status"]';
const INLINE_OUTPUT = '.quarto-inline-output';
const OUTPUT_CONTENT = '.quarto-output-content';
const OUTPUT_ITEM = '.quarto-output-item';
const CELL_TOOLBAR = '.quarto-cell-toolbar';
const TOOLBAR_RUN = '.quarto-toolbar-run';
const OUTPUT_CLOSE = '.quarto-output-close';
const OUTPUT_COPY = '.quarto-output-copy';
const OUTPUT_SAVE = '.quarto-output-save';
const OUTPUT_POPOUT = '.quarto-output-popout';
const OUTPUT_STDOUT = '.quarto-output-stdout';
const OUTPUT_HTML = '.quarto-output-html';
const OUTPUT_IMAGE = '.quarto-output-image';
const OUTPUT_ERROR = '.quarto-output-error';
const OUTPUT_WEBVIEW = '.quarto-output-webview-container';
const IMAGE_PREVIEW_WRAPPER = '.quarto-image-preview-wrapper';
const IMAGE_PREVIEW = '.quarto-image-preview';
const IMAGE_PREVIEW_ERROR = '.quarto-image-preview-error';
const TRUNCATION_HEADER = '.quarto-output-truncation-header';
const OPEN_IN_EDITOR = '.quarto-output-open-in-editor';
/**
 * Page Object Model for Quarto Inline Output feature.
 */
class InlineQuarto {
    code;
    quickaccess;
    hotKeys;
    // --- Locators ---
    kernelStatusWidget;
    inlineOutput;
    outputContent;
    outputItem;
    cellToolbar;
    toolbarRunButton;
    toolbarCancelButton;
    closeButton;
    copyButton;
    saveButton;
    popoutButton;
    stdoutOutput;
    htmlOutput;
    imageOutput;
    errorOutput;
    webviewContainer;
    webviewOrHtmlOutput;
    imagePreviewWrapper;
    imagePreview;
    imagePreviewError;
    truncationHeader;
    openInEditorLink;
    constructor(code, quickaccess, hotKeys) {
        this.code = code;
        this.quickaccess = quickaccess;
        this.hotKeys = hotKeys;
        const page = code.driver.currentPage;
        this.kernelStatusWidget = page.locator(KERNEL_STATUS_WIDGET);
        this.inlineOutput = page.locator(INLINE_OUTPUT);
        this.outputContent = page.locator(`${INLINE_OUTPUT} ${OUTPUT_CONTENT}`);
        this.outputItem = page.locator(`${INLINE_OUTPUT} ${OUTPUT_ITEM}`);
        this.cellToolbar = page.locator(CELL_TOOLBAR);
        this.toolbarRunButton = page.locator(`${CELL_TOOLBAR} ${TOOLBAR_RUN}`);
        this.toolbarCancelButton = page.getByRole('button', { name: 'Cancel pending execution' });
        this.closeButton = page.locator(`${INLINE_OUTPUT} ${OUTPUT_CLOSE}`);
        this.copyButton = page.locator(`${INLINE_OUTPUT} ${OUTPUT_COPY}`);
        this.saveButton = page.locator(`${INLINE_OUTPUT} ${OUTPUT_SAVE}`);
        this.popoutButton = page.locator(`${INLINE_OUTPUT} ${OUTPUT_POPOUT}`);
        this.stdoutOutput = page.locator(`${INLINE_OUTPUT} ${OUTPUT_STDOUT}`);
        this.htmlOutput = page.locator(`${INLINE_OUTPUT} ${OUTPUT_HTML}`);
        this.imageOutput = page.locator(`${INLINE_OUTPUT} ${OUTPUT_IMAGE}`);
        this.errorOutput = page.locator(`${INLINE_OUTPUT} ${OUTPUT_ERROR}`);
        this.webviewContainer = page.locator(`${INLINE_OUTPUT} ${OUTPUT_WEBVIEW}`);
        this.webviewOrHtmlOutput = page.locator(`${INLINE_OUTPUT}`).locator(`${OUTPUT_WEBVIEW}, ${OUTPUT_HTML}`);
        this.imagePreviewWrapper = page.locator(IMAGE_PREVIEW_WRAPPER);
        this.imagePreview = page.locator(IMAGE_PREVIEW);
        this.imagePreviewError = page.locator(IMAGE_PREVIEW_ERROR);
        this.truncationHeader = page.locator(`${INLINE_OUTPUT} ${TRUNCATION_HEADER}`);
        this.openInEditorLink = page.locator(`${INLINE_OUTPUT} ${OPEN_IN_EDITOR}`);
    }
    // --- Getters ---
    getInlineOutputAt(index) {
        return this.inlineOutput.nth(index);
    }
    getOutputContentAt(index) {
        return this.inlineOutput.nth(index).locator(OUTPUT_CONTENT);
    }
    getOutputItemAt(index) {
        return this.inlineOutput.nth(index).locator(OUTPUT_ITEM).first();
    }
    async getKernelText() {
        const kernelText = await this.kernelStatusWidget.locator('.kernel-label').textContent();
        if (kernelText === null) {
            throw new Error('Kernel text is null');
        }
        return kernelText;
    }
    // --- Actions ---
    async gotoLine(lineNumber) {
        await test_1.default.step(`Go to line ${lineNumber}`, async () => {
            await this.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
            await this.code.driver.currentPage.keyboard.type(String(lineNumber));
            await this.code.driver.currentPage.keyboard.press('Enter');
        });
    }
    async runCurrentCell({ via = 'hotkey' } = {}) {
        await test_1.default.step(`Run current Quarto cell via ${via}`, async () => {
            via === 'hotkey'
                ? await this.hotKeys.runCurrentQuartoCell()
                : await this.quickaccess.runCommand('quarto.runCurrentCell');
        });
    }
    async runCurrentCode({ via = 'hotkey' } = {}) {
        await test_1.default.step(`Run current Quarto code via ${via}`, async () => {
            via === 'hotkey'
                ? await this.hotKeys.runCurrentQuartoCode()
                : await this.quickaccess.runCommand('quarto.runCurrent');
        });
    }
    async runAllCells() {
        await test_1.default.step('Run all Quarto cells', async () => {
            await this.quickaccess.runCommand('quarto.runAllCells');
        });
    }
    async clearAllOutputs() {
        await test_1.default.step('Clear all Quarto inline outputs', async () => {
            await this.quickaccess.runCommand('positronQuarto.clearAllOutputs');
        });
    }
    async runCellAndWaitForOutput({ cellLine, outputLine, timeout = 120000 }) {
        await test_1.default.step(`Run cell at line ${cellLine} and wait for output at line ${outputLine}`, async () => {
            await this.gotoLine(cellLine);
            await this.runCurrentCell();
            await this.gotoLine(outputLine);
            await (0, test_1.expect)(this.inlineOutput).toBeVisible({ timeout });
        });
    }
    async runCodeAndWaitForOutput({ cellLine, outputLine, timeout = 120000 }) {
        await test_1.default.step(`Run code at line ${cellLine} and wait for output at line ${outputLine}`, async () => {
            await this.gotoLine(cellLine);
            await this.runCurrentCode();
            await this.gotoLine(outputLine);
            await (0, test_1.expect)(this.inlineOutput).toBeVisible({ timeout });
        });
    }
    async clickToolbarRunButton(index = 0) {
        await test_1.default.step(`Click run button on cell toolbar ${index}`, async () => {
            const runButton = this.cellToolbar.nth(index).locator(TOOLBAR_RUN);
            await (0, test_1.expect)(runButton).toBeVisible({ timeout: 10000 });
            await runButton.click();
        });
    }
    async clickToolbarCancelButton() {
        await test_1.default.step(`Click cancel button on cell toolbar`, async () => {
            await this.toolbarCancelButton.click();
        });
    }
    async closeOutput() {
        await test_1.default.step('Close inline output', async () => {
            await this.closeButton.click();
            await (0, test_1.expect)(this.inlineOutput).not.toBeVisible({ timeout: 5000 });
        });
    }
    async copyOutput() {
        await test_1.default.step('Copy inline output', async () => {
            await this.copyButton.click();
            await (0, test_1.expect)(this.copyButton).toHaveClass(/copy-success/);
        });
    }
    async runCopyCommand() {
        await test_1.default.step('Run copy output command', async () => {
            await this.quickaccess.runCommand('positronQuarto.copyOutput');
        });
    }
    async popoutOutput() {
        await test_1.default.step('Popout inline output', async () => {
            await this.popoutButton.click();
        });
    }
    async runPopoutCommand() {
        await test_1.default.step('Run popout output command', async () => {
            await this.quickaccess.runCommand('positronQuarto.popoutOutput');
        });
    }
    async selectStdoutTextViaDrag() {
        await test_1.default.step('Select stdout text via click-and-drag', async () => {
            const page = this.code.driver.currentPage;
            const boundingBox = await this.stdoutOutput.first().boundingBox();
            (0, test_1.expect)(boundingBox).not.toBeNull();
            await page.evaluate(() => window.getSelection()?.removeAllRanges());
            const startX = boundingBox.x + 10;
            const startY = boundingBox.y + boundingBox.height / 2;
            const endX = boundingBox.x + Math.min(boundingBox.width - 10, 200);
            const endY = startY;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(endX, endY, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(200);
        });
    }
    // --- Verifications ---
    async expectKernelToHaveText(name, timeout = 30000) {
        await test_1.default.step(`Expect kernel text to be "${name}"`, async () => {
            const kernelLabel = this.kernelStatusWidget.locator('.kernel-label');
            await (0, test_1.expect)(kernelLabel).toBeVisible({ timeout });
            await (0, test_1.expect)(kernelLabel).toHaveText(name, { timeout });
        });
    }
    async expectKernelStatusVisible(timeout = 30000) {
        await test_1.default.step('Expect kernel status widget visible', async () => {
            await (0, test_1.expect)(this.kernelStatusWidget.first()).toBeVisible({ timeout });
        });
    }
    async expectOutputsExist(count, timeout = 30000) {
        await test_1.default.step(`Expect ${count} output(s) exist in DOM`, async () => {
            await (0, test_1.expect)(this.inlineOutput).toHaveCount(count, { timeout });
        });
    }
    async expectOutputVisible({ index = 0, timeout = 30000 } = {}) {
        await test_1.default.step(`Expect output at index ${index} visible on screen`, async () => {
            await (0, test_1.expect)(this.getOutputContentAt(index)).toBeVisible({ timeout });
        });
    }
    async expectOutputContentCount(count) {
        await test_1.default.step(`Verify output content area has ${count} items`, async () => {
            const contentCount = await this.outputContent.count();
            (0, test_1.expect)(contentCount).toBe(count);
        });
    }
    async expectOutputItemCount(count) {
        await test_1.default.step(`Verify output item count is ${count}`, async () => {
            const itemCount = await this.outputItem.count();
            (0, test_1.expect)(itemCount).toBe(count);
        });
    }
    async expectErrorCount(count) {
        await test_1.default.step(`Expect ${count} error output(s)`, async () => {
            const errorCount = await this.errorOutput.count();
            (0, test_1.expect)(errorCount).toBe(count);
        });
    }
    async expectHtmlOutputVisible() {
        await test_1.default.step('Verify HTML output present', async () => {
            const htmlCount = await this.htmlOutput.count();
            (0, test_1.expect)(htmlCount).toBeGreaterThan(0);
        });
    }
    async expectWebviewOrHtmlVisible(timeout = 30000) {
        await test_1.default.step('Verify webview or HTML output visible', async () => {
            await (0, test_1.expect)(this.webviewOrHtmlOutput.first()).toBeVisible({ timeout });
        });
    }
    async expectStdoutContains(expectedText, timeout = 5000) {
        await test_1.default.step(`Verify stdout contains "${expectedText}"`, async () => {
            await (0, test_1.expect)(this.stdoutOutput.first()).toBeVisible({ timeout });
            await (0, test_1.expect)(this.stdoutOutput.first()).toContainText(expectedText);
        });
    }
    async expectOutputContainsText(text, { index = 0, timeout = 10000 } = {}) {
        await test_1.default.step(`Expect output at index ${index} contains "${text}"`, async () => {
            await (0, test_1.expect)(this.getOutputContentAt(index)).toContainText(text, { timeout });
        });
    }
    async expectOutputNotContainsText(text, { index = 0, timeout = 10000 } = {}) {
        await test_1.default.step(`Expect output at index ${index} does not contain "${text}"`, async () => {
            await (0, test_1.expect)(this.getOutputContentAt(index)).not.toContainText(text, { timeout });
        });
    }
    async expectTextSelectedAndContains(expectedStrings) {
        await test_1.default.step(`Verify text is selected and contains one of: ${expectedStrings.join(', ')}`, async () => {
            const selectedText = await this.code.driver.currentPage.evaluate(() => {
                const selection = window.getSelection();
                return selection ? selection.toString().trim() : '';
            });
            (0, test_1.expect)(selectedText.length).toBeGreaterThan(0);
            const containsExpected = expectedStrings.some(str => selectedText.includes(str));
            (0, test_1.expect)(containsExpected).toBe(true);
        });
    }
    async expectStdoutNotContains(forbiddenStrings) {
        await test_1.default.step(`Expect stdout does not contain: ${forbiddenStrings.join(', ')}`, async () => {
            const stdoutCount = await this.stdoutOutput.count();
            if (stdoutCount > 0) {
                const stdoutText = await this.stdoutOutput.first().textContent();
                for (const forbidden of forbiddenStrings) {
                    (0, test_1.expect)(stdoutText).not.toContain(forbidden);
                }
            }
        });
    }
    async expectNoDataExplorerMetadata() {
        await test_1.default.step('Expect no data explorer metadata in output', async () => {
            const allOutputText = await this.inlineOutput.textContent();
            (0, test_1.expect)(allOutputText).not.toContain('comm_id');
            (0, test_1.expect)(allOutputText).not.toContain('vnd.positron.dataExplorer');
        });
    }
    async expectCopySuccess(timeout = 2000) {
        await test_1.default.step('Verify copy success feedback', async () => {
            await (0, test_1.expect)(this.copyButton).toHaveClass(/copy-success/, { timeout });
        });
    }
    async expectCopySuccessReverted(timeout = 2000) {
        await test_1.default.step('Verify copy success feedback reverted', async () => {
            await (0, test_1.expect)(this.copyButton).not.toHaveClass(/copy-success/, { timeout });
        });
    }
    async expectKernelRunning(timeout = 30000) {
        let kernelText = null;
        await test_1.default.step('Verify kernel is running', async () => {
            const kernelLabel = this.kernelStatusWidget.locator('.kernel-label');
            await (0, test_1.expect)(kernelLabel).toBeVisible({ timeout });
            await (0, test_1.expect)(kernelLabel).not.toHaveText(/No Kernel|Starting\.\.\./, { timeout });
        });
        return kernelText;
    }
    async expectPendingExecution({ timeout } = { timeout: 5000 }) {
        await test_1.default.step(`Expect cell is pending execution`, async () => {
            await (0, test_1.expect)(this.toolbarCancelButton).toBeVisible({ timeout });
        });
    }
}
exports.InlineQuarto = InlineQuarto;
//# sourceMappingURL=inlineQuarto.js.map