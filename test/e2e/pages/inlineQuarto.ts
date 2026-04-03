/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { HotKeys } from './hotKeys.js';

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
export class InlineQuarto {
	private code: Code;
	private quickaccess: QuickAccess;
	private hotKeys: HotKeys;

	// --- Locators ---

	readonly kernelStatusWidget: Locator;
	readonly inlineOutput: Locator;
	readonly outputContent: Locator;
	readonly outputItem: Locator;
	readonly cellToolbar: Locator;
	readonly visibleCellToolbar: Locator;
	readonly toolbarRunButton: Locator;
	readonly toolbarCancelButton: Locator;
	readonly closeButton: Locator;
	readonly copyButton: Locator;
	readonly saveButton: Locator;
	readonly popoutButton: Locator;
	readonly stdoutOutput: Locator;
	readonly htmlOutput: Locator;
	readonly imageOutput: Locator;
	readonly errorOutput: Locator;
	readonly webviewContainer: Locator;
	readonly webviewOrHtmlOutput: Locator;
	readonly imagePreviewWrapper: Locator;
	readonly imagePreview: Locator;
	readonly imagePreviewError: Locator;
	readonly truncationHeader: Locator;
	readonly openInEditorLink: Locator;

	constructor(code: Code, quickaccess: QuickAccess, hotKeys: HotKeys) {
		this.code = code;
		this.quickaccess = quickaccess;
		this.hotKeys = hotKeys;
		const page = code.driver.page;

		this.kernelStatusWidget = page.locator(KERNEL_STATUS_WIDGET);
		this.inlineOutput = page.locator(INLINE_OUTPUT);
		this.outputContent = page.locator(`${INLINE_OUTPUT} ${OUTPUT_CONTENT}`);
		this.outputItem = page.locator(`${INLINE_OUTPUT} ${OUTPUT_ITEM}`);
		this.cellToolbar = page.locator(CELL_TOOLBAR);
		this.visibleCellToolbar = page.locator(`${CELL_TOOLBAR}.visible`);
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

	getInlineOutputAt(index: number): Locator {
		return this.inlineOutput.nth(index);
	}

	getOutputContentAt(index: number): Locator {
		return this.inlineOutput.nth(index).locator(OUTPUT_CONTENT);
	}

	getOutputItemAt(index: number): Locator {
		return this.inlineOutput.nth(index).locator(OUTPUT_ITEM).first();
	}

	async getKernelText(): Promise<string> {
		const kernelText = await this.kernelStatusWidget.locator('.kernel-label').textContent();
		if (kernelText === null) {
			throw new Error('Kernel text is null');
		}
		return kernelText;
	}

	// --- Actions ---

	async gotoLine(lineNumber: number): Promise<void> {
		await test.step(`Go to line ${lineNumber}`, async () => {
			await this.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await this.code.driver.page.keyboard.type(String(lineNumber));
			await this.code.driver.page.keyboard.press('Enter');
		});
	}

	async runCurrentCell({ via = 'hotkey' }: { via?: 'command' | 'hotkey' } = {}): Promise<void> {
		await test.step(`Run current Quarto cell via ${via}`, async () => {
			via === 'hotkey'
				? await this.hotKeys.runCurrentQuartoCell()
				: await this.quickaccess.runCommand('quarto.runCurrentCell');
		});
	}

	async runCurrentCode({ via = 'hotkey' }: { via?: 'command' | 'hotkey' } = {}): Promise<void> {
		await test.step(`Run current Quarto code via ${via}`, async () => {
			via === 'hotkey'
				? await this.hotKeys.runCurrentQuartoCode()
				: await this.quickaccess.runCommand('quarto.runCurrent');
		});
	}

	async runAllCells(): Promise<void> {
		await test.step('Run all Quarto cells', async () => {
			await this.quickaccess.runCommand('quarto.runAllCells');
		});
	}

	async clearAllOutputs(): Promise<void> {
		await test.step('Clear all Quarto inline outputs', async () => {
			await this.quickaccess.runCommand('positronQuarto.clearAllOutputs');
		});
	}

	async runCellAndWaitForOutput({ cellLine, outputLine, timeout = 120000 }: { cellLine: number; outputLine: number; timeout?: number }): Promise<void> {
		await test.step(`Run cell at line ${cellLine} and wait for output at line ${outputLine}`, async () => {
			await this.gotoLine(cellLine);
			await this.runCurrentCell();
			await this.gotoLine(outputLine);
			await expect(this.inlineOutput).toBeVisible({ timeout });
		});
	}

	async runCodeAndWaitForOutput({ cellLine, outputLine, timeout = 120000 }: { cellLine: number; outputLine: number; timeout?: number }): Promise<void> {
		await test.step(`Run code at line ${cellLine} and wait for output at line ${outputLine}`, async () => {
			await this.gotoLine(cellLine);
			await this.runCurrentCode();
			await this.gotoLine(outputLine);
			await expect(this.inlineOutput).toBeVisible({ timeout });
		});
	}

	async clickToolbarRunButton(index = 0): Promise<void> {
		await test.step(`Click run button on cell toolbar ${index}`, async () => {
			const runButton = this.cellToolbar.nth(index).locator(TOOLBAR_RUN);
			await expect(runButton).toBeVisible({ timeout: 10000 });
			await runButton.click();
		});
	}

	async clickToolbarCancelButton(): Promise<void> {
		await test.step(`Click cancel button on cell toolbar`, async () => {
			await this.toolbarCancelButton.click();
		});
	}

	async closeOutput(): Promise<void> {
		await test.step('Close inline output', async () => {
			await this.closeButton.click();
			await expect(this.inlineOutput).not.toBeVisible({ timeout: 5000 });
		});
	}

	async copyOutput(): Promise<void> {
		await test.step('Copy inline output', async () => {
			await this.copyButton.click();
			await expect(this.copyButton).toHaveClass(/copy-success/);
		});
	}

	async runCopyCommand(): Promise<void> {
		await test.step('Run copy output command', async () => {
			await this.quickaccess.runCommand('positronQuarto.copyOutput');
		});
	}

	async popoutOutput(): Promise<void> {
		await test.step('Popout inline output', async () => {
			await this.popoutButton.click();
		});
	}

	async runPopoutCommand(): Promise<void> {
		await test.step('Run popout output command', async () => {
			await this.quickaccess.runCommand('positronQuarto.popoutOutput');
		});
	}

	async selectStdoutTextViaDrag(): Promise<void> {
		await test.step('Select stdout text via click-and-drag', async () => {
			const page = this.code.driver.page;
			const boundingBox = await this.stdoutOutput.first().boundingBox();
			expect(boundingBox).not.toBeNull();

			await page.evaluate(() => window.getSelection()?.removeAllRanges());

			const startX = boundingBox!.x + 10;
			const startY = boundingBox!.y + boundingBox!.height / 2;
			const endX = boundingBox!.x + Math.min(boundingBox!.width - 10, 200);
			const endY = startY;

			await page.mouse.move(startX, startY);
			await page.mouse.down();
			await page.mouse.move(endX, endY, { steps: 10 });
			await page.mouse.up();
			await page.waitForTimeout(200);
		});
	}

	// --- Verifications ---

	async expectKernelToHaveText(name: string | RegExp, timeout = 30000): Promise<void> {
		await test.step(`Expect kernel text to be "${name}"`, async () => {
			const kernelLabel = this.kernelStatusWidget.locator('.kernel-label');
			await expect(kernelLabel).toBeVisible({ timeout });
			await expect(kernelLabel).toHaveText(name, { timeout });
		});
	}

	async expectKernelStatusVisible(timeout = 30000): Promise<void> {
		await test.step('Expect kernel status widget visible', async () => {
			await expect(this.kernelStatusWidget.first()).toBeVisible({ timeout });
		});
	}

	async expectOutputsExist(count: number, timeout = 30000): Promise<void> {
		await test.step(`Expect ${count} output(s) exist in DOM`, async () => {
			await expect(this.inlineOutput).toHaveCount(count, { timeout });
		});
	}

	async expectOutputVisible({ index = 0, timeout = 30000 }: { index?: number; timeout?: number } = {}): Promise<void> {
		await test.step(`Expect output at index ${index} visible on screen`, async () => {
			await expect(this.getOutputContentAt(index)).toBeVisible({ timeout });
		});
	}

	async expectOutputContentCount(count: number): Promise<void> {
		await test.step(`Verify output content area has ${count} items`, async () => {
			const contentCount = await this.outputContent.count();
			expect(contentCount).toBe(count);
		});
	}

	async expectOutputItemCount(count: number): Promise<void> {
		await test.step(`Verify output item count is ${count}`, async () => {
			const itemCount = await this.outputItem.count();
			expect(itemCount).toBe(count);
		});
	}

	async expectErrorCount(count: number): Promise<void> {
		await test.step(`Expect ${count} error output(s)`, async () => {
			const errorCount = await this.errorOutput.count();
			expect(errorCount).toBe(count);
		});
	}

	async expectHtmlOutputVisible(): Promise<void> {
		await test.step('Verify HTML output present', async () => {
			const htmlCount = await this.htmlOutput.count();
			expect(htmlCount).toBeGreaterThan(0);
		});
	}

	async expectWebviewOrHtmlVisible(timeout = 30000): Promise<void> {
		await test.step('Verify webview or HTML output visible', async () => {
			await expect(this.webviewOrHtmlOutput.first()).toBeVisible({ timeout });
		});
	}

	async expectStdoutContains(expectedText: string, timeout = 5000): Promise<void> {
		await test.step(`Verify stdout contains "${expectedText}"`, async () => {
			await expect(this.stdoutOutput.first()).toBeVisible({ timeout });
			await expect(this.stdoutOutput.first()).toContainText(expectedText);
		});
	}

	async expectOutputContainsText(text: string | RegExp, { index = 0, timeout = 10000 }: { index?: number; timeout?: number } = {}): Promise<void> {
		await test.step(`Expect output at index ${index} contains "${text}"`, async () => {
			await expect(this.getOutputContentAt(index)).toContainText(text, { timeout });
		});
	}

	async expectOutputNotContainsText(text: string, { index = 0, timeout = 10000 }: { index?: number; timeout?: number } = {}): Promise<void> {
		await test.step(`Expect output at index ${index} does not contain "${text}"`, async () => {
			await expect(this.getOutputContentAt(index)).not.toContainText(text, { timeout });
		});
	}

	async expectTextSelectedAndContains(expectedStrings: string[]): Promise<void> {
		await test.step(`Verify text is selected and contains one of: ${expectedStrings.join(', ')}`, async () => {
			const selectedText = await this.code.driver.page.evaluate(() => {
				const selection = window.getSelection();
				return selection ? selection.toString().trim() : '';
			});
			expect(selectedText.length).toBeGreaterThan(0);
			const containsExpected = expectedStrings.some(str => selectedText.includes(str));
			expect(containsExpected).toBe(true);
		});
	}

	async expectStdoutNotContains(forbiddenStrings: string[]): Promise<void> {
		await test.step(`Expect stdout does not contain: ${forbiddenStrings.join(', ')}`, async () => {
			const stdoutCount = await this.stdoutOutput.count();
			if (stdoutCount > 0) {
				const stdoutText = await this.stdoutOutput.first().textContent();
				for (const forbidden of forbiddenStrings) {
					expect(stdoutText).not.toContain(forbidden);
				}
			}
		});
	}

	async expectNoDataExplorerMetadata(): Promise<void> {
		await test.step('Expect no data explorer metadata in output', async () => {
			const allOutputText = await this.inlineOutput.textContent();
			expect(allOutputText).not.toContain('comm_id');
			expect(allOutputText).not.toContain('vnd.positron.dataExplorer');
		});
	}

	async expectCopySuccess(timeout = 2000): Promise<void> {
		await test.step('Verify copy success feedback', async () => {
			await expect(this.copyButton).toHaveClass(/copy-success/, { timeout });
		});
	}

	async expectCopySuccessReverted(timeout = 2000): Promise<void> {
		await test.step('Verify copy success feedback reverted', async () => {
			await expect(this.copyButton).not.toHaveClass(/copy-success/, { timeout });
		});
	}

	async expectKernelIdle(timeout = 30000): Promise<string> {
		let kernelText: string | null = null;
		await test.step('Verify kernel is idle', async () => {
			const kernelLabel = this.kernelStatusWidget.locator('.kernel-label');
			await expect(kernelLabel).toBeVisible({ timeout });
			await expect(kernelLabel).not.toHaveText(/No Kernel|Starting\.\.\./, { timeout });
			await expect(this.kernelStatusWidget.locator('.codicon-positron-runtime-status-idle')).toBeVisible();
		});
		return kernelText!;
	}

	async expectSingleVisibleToolbar(timeout = 15000): Promise<void> {
		await test.step('Expect exactly one visible cell toolbar', async () => {
			await expect(this.visibleCellToolbar).toHaveCount(1, { timeout });
		});
	}

	async expectPendingExecution({ timeout }: { timeout?: number } = { timeout: 5000 }): Promise<void> {
		await test.step(`Expect cell is pending execution`, async () => {
			await expect(this.toolbarCancelButton).toBeVisible({ timeout });
		});
	}
}
