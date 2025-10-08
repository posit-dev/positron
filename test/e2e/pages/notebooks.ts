/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { QuickAccess } from './quickaccess';
import { basename } from 'path';
import test, { expect, FrameLocator, Locator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';

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
export class Notebooks {
	protected code: Code;
	protected quickinput: QuickInput;
	protected quickaccess: QuickAccess;
	protected hotKeys: HotKeys;

	kernelLabel: Locator;
	kernelDropdown: Locator;
	frameLocator: FrameLocator;
	notebookProgressBar: Locator;
	cellIndex: (num?: number) => Locator;

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		this.code = code;
		this.quickinput = quickinput;
		this.quickaccess = quickaccess;
		this.hotKeys = hotKeys;

		this.kernelLabel = this.code.driver.page.locator(KERNEL_LABEL);
		this.kernelDropdown = this.code.driver.page.locator(KERNEL_DROPDOWN);
		this.frameLocator = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
		this.notebookProgressBar = this.code.driver.page.locator('[id="workbench\\.parts\\.editor"]').getByRole('progressbar');
		this.cellIndex = (num = 0) => this.code.driver.page.locator('.cell-inner-container > .cell').nth(num);
	}

	async selectInterpreter(
		kernelGroup: 'Python' | 'R',
		desiredKernel = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!
	) {
		await test.step(`Select kernel: ${desiredKernel}`, async () => {
			await expect(this.notebookProgressBar).not.toBeVisible({ timeout: 30000 });
			await expect(this.code.driver.page.locator(DETECTING_KERNELS_TEXT)).not.toBeVisible({ timeout: 30000 });

			try {
				// 1. Try finding by text
				await expect(this.kernelDropdown.filter({ hasText: desiredKernel })).toBeVisible({ timeout: 2500 });
				this.code.logger.log(`Kernel: found by text: ${desiredKernel}`);
				return;
			} catch (e) {
				this.code.logger.log(`Kernel: not found by text: ${desiredKernel}`);
			}

			try {
				// 2. Try finding by label
				const kernelLabelLocator = this.code.driver.page.locator(KERNEL_LABEL);
				await expect(kernelLabelLocator).toHaveAttribute('aria-label', new RegExp(desiredKernel), { timeout: 2500 });
				this.code.logger.log(`Kernel: found by label: ${desiredKernel}`);
				return;
			} catch (e) {
				this.code.logger.log(`Kernel: not found by label: ${desiredKernel}`);
			}

			// 3. Open dropdown to select kernel
			this.code.logger.log(`Kernel: opening dropdown to select: ${desiredKernel}`);

			await this.code.driver.page.locator(KERNEL_DROPDOWN).click();
			await this.quickinput.waitForQuickInputOpened();
			await this.code.driver.page.getByText('Select Environment...').click();
			await this.quickinput.type(desiredKernel);
			await this.quickinput.selectQuickInputElementContaining(`${kernelGroup} ${desiredKernel}`);
			await this.quickinput.waitForQuickInputClosed();

			// Wait for kernel initialization
			await expect(this.code.driver.page.locator('.kernel-action-view-item .codicon-modifier-spin')).not.toBeVisible({ timeout: 30000 });
		});
	}

	async expectKernelToBe(kernelName: string) {
		await test.step(`Expect kernel to be: ${kernelName}`, async () => {
			await expect(this.kernelDropdown).toHaveText(new RegExp(escapeRegExp(kernelName), 'i'), { timeout: 30000 });
		});
	}

	async createNewNotebook() {
		await test.step('Create new notebook', async () => {
			await this.quickaccess.runCommand(NEW_NOTEBOOK_COMMAND);
		});
	}

	// Opens a Notebook that lives in the current workspace
	// checkForActiveCell is set to false for Positron notebooks which don't have the same cell structure as VS Code notebooks.
	async openNotebook(path: string, checkForActiveCell = true) {
		await test.step(`Open notebook: ${path}`, async () => {
			await this.quickaccess.openFileQuickAccessAndWait(basename(path), 1);
			await this.quickinput.selectQuickInputElement(0);

			if (checkForActiveCell) {
				await expect(this.code.driver.page.locator(ACTIVE_ROW_SELECTOR)).toBeVisible();
				await this.focusFirstCell();
			}
		});
	}

	async addCodeToCellAtIndex(cellIndex: number, code: string, delay = 0) {
		await test.step('Add code to first cell', async () => {
			await this.selectCellAtIndex(cellIndex);
			await this.typeInEditor(code, delay);
		});
	}

	async hoverCellText(cellIndex: number, text: string) {
		await test.step(`Hover cell ${cellIndex} text: "${text}"`, async () => {

			const cellText = this.code.driver.page.locator(CELL_LINE).nth(cellIndex).locator('span').locator('span').filter(
				{ hasText: text }
			);
			await cellText.click();
			await cellText.hover();
		});
	}

	async executeCodeInCell() {
		await test.step('Execute code in cell', async () => {
			await this.quickaccess.runCommand(EXECUTE_CELL_COMMAND);
			await expect(this.code.driver.page.locator(EXECUTE_CELL_SPINNER), 'execute cell spinner to not be visible').toHaveCount(0, { timeout: 30000 });
		});
	}

	async assertCellOutput(text: string | RegExp, cellIndex?: number): Promise<void> {
		if (cellIndex !== undefined) {
			// Target specific cell output
			const cellOutput = this.frameLocator.locator('.output_container').nth(cellIndex);
			await expect(cellOutput.getByText(text)).toBeVisible({ timeout: 15000 });
		} else {
			// Use nth(0) to get the first occurrence when multiple elements exist
			await expect(this.frameLocator.getByText(text).nth(0)).toBeVisible({ timeout: 15000 });
		}
	}

	async closeNotebookWithoutSaving() {
		await this.quickaccess.runCommand(REVERT_AND_CLOSE);
	}

	async assertMarkdownText(tag: string, expectedText: string): Promise<void> {
		const markdownLocator = this.frameLocator.locator(`${MARKDOWN_TEXT} ${tag}`);
		await expect(markdownLocator).toBeVisible();
		await expect(markdownLocator).toHaveText(expectedText);
	}

	async runAllCells(timeout: number = 30000) {
		await test.step('Run all cells', async () => {
			await this.code.driver.page.getByLabel('Run All').click();
			const stopExecutionLocator = this.code.driver.page.locator('a').filter({ hasText: /Stop Execution|Interrupt/ });
			try {
				await expect(stopExecutionLocator).toBeVisible();
				await expect(stopExecutionLocator).not.toBeVisible({ timeout });
			} catch { } // can be normal with very fast execution
		});
	}

	async focusFirstCell() {
		await this.quickaccess.runCommand('notebook.focusTop');
	}

	async deleteAllCells() {
		const cellCount = await this.code.driver.page.locator('.cell-inner-container > .cell').count();
		for (let i = cellCount; i > 0; i--) {
			await this.cellIndex(i - 1).click();
			await this.code.driver.page.getByRole('button', { name: 'Delete Cell' }).click();
		}
	}

	async typeInEditor(text: string, delay = 0): Promise<any> {
		await test.step(`Type in editor: ${text}`, async () => {
			const editor = `${ACTIVE_ROW_SELECTOR} .monaco-editor`;

			await this.code.driver.page.locator(editor).isVisible();

			const textarea = `${editor} textarea`;
			await expect(this.code.driver.page.locator(textarea)).toBeFocused();

			delay
				? await this.code.driver.page.locator(textarea).pressSequentially(text, { delay })
				: await this.code.driver.page.locator(textarea).fill(text);
		});
	}

	private async _waitForActiveCellEditorContents(accept: (contents: string) => boolean): Promise<string> {
		const selector = `${ACTIVE_ROW_SELECTOR} .monaco-editor .view-lines`;
		const locator = this.code.driver.page.locator(selector);

		let content = '';
		await expect(async () => {
			content = (await locator.textContent())?.replace(/\u00a0/g, ' ') || '';
			if (!accept(content)) {
				throw new Error(`Content did not match condition: ${content}`);
			}
		}).toPass();

		return content;
	}

	async waitForActiveCellEditorContents(contents: string): Promise<string> {
		return this._waitForActiveCellEditorContents(content => content === contents);
	}

	async insertNotebookCell(kind: 'markdown' | 'code'): Promise<void> {
		await expect(async () => {
			if (kind === 'markdown') {
				await this.quickaccess.runCommand('notebook.cell.insertMarkdownCellBelow');
			} else {
				await this.quickaccess.runCommand('notebook.cell.insertCodeCellBelow');
			}
		}).toPass({ timeout: 60000 });
	}

	async selectCellAtIndex(cellIndex: number): Promise<void> {
		await test.step(`Select cell at index: ${cellIndex}`, async () => {
			if (cellIndex === 0) {
				for (let i = 0; i < 5; i++) {
					await this.code.driver.page.keyboard.press('ArrowUp');
				}
			}
			await this.code.driver.page.locator(CELL_LINE).nth(cellIndex).click();
		});
	}

	async stopEditingCell() {
		await this.quickaccess.runCommand('notebook.cell.quitEdit');
	}

	async executeActiveCell(): Promise<void> {
		await this.hotKeys.executeNotebookCell();
		await expect(this.code.driver.page.getByRole('button', { name: 'Go To' })).not.toBeVisible({ timeout: 30000 });
	}
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
