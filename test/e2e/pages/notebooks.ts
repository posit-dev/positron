/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { QuickAccess } from './quickaccess';
import { basename } from 'path';
import test, { expect } from '@playwright/test';

const KERNEL_DROPDOWN = 'a.kernel-label';
const KERNEL_LABEL = '.codicon-notebook-kernel-select';
const DETECTING_KERNELS_TEXT = 'Detecting Kernels';
const NEW_NOTEBOOK_COMMAND = 'ipynb.newUntitledIpynb';
const CELL_LINE = '.cell div.view-lines';
const EXECUTE_CELL_COMMAND = 'notebook.cell.execute';
const EXECUTE_CELL_SPINNER = '.cell-status-item .codicon-modifier-spin';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REVERT_AND_CLOSE = 'workbench.action.revertAndCloseActiveEditor';
const MARKDOWN_TEXT = '#preview';
const ACTIVE_ROW_SELECTOR = `.notebook-editor .monaco-list-row.focused`;

/*
 *  Reuseable Positron notebook functionality for tests to leverage.  Includes selecting the notebook's interpreter.
 */
export class Notebooks {
	kernelLabel = this.code.driver.page.locator(KERNEL_LABEL);
	kernelDropdown = this.code.driver.page.locator(KERNEL_DROPDOWN);
	frameLocator = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	notebookProgressBar = this.code.driver.page.locator('[id="workbench\\.parts\\.editor"]').getByRole('progressbar');


	constructor(private code: Code, private quickinput: QuickInput, private quickaccess: QuickAccess) { }

	async selectInterpreter(
		kernelGroup: 'Python' | 'R',
		desiredKernel = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!
	) {
		await test.step(`Select notebook interpreter: ${desiredKernel}`, async () => {
			await expect(this.notebookProgressBar).not.toBeVisible({ timeout: 30000 });
			await expect(this.code.driver.page.locator(DETECTING_KERNELS_TEXT)).not.toBeVisible({ timeout: 30000 });

			try {
				// 1. Try finding by text
				await expect(this.kernelDropdown.filter({ hasText: desiredKernel })).toBeVisible({ timeout: 5000 });
				this.code.logger.log(`Kernel: found by text: ${desiredKernel}`);
				return;
			} catch (e) {
				this.code.logger.log(`Kernel: not found by text: ${desiredKernel}`);
			}

			try {
				// 2. Try finding by label
				const kernelLabelLocator = this.code.driver.page.locator(KERNEL_LABEL);
				await expect(kernelLabelLocator).toHaveAttribute('aria-label', new RegExp(desiredKernel), { timeout: 5000 });
				this.code.logger.log(`Kernel: found by label: ${desiredKernel}`);
				return;
			} catch (e) {
				this.code.logger.log(`Kernel: not found by label: ${desiredKernel}`);
			}

			// 3. Open dropdown to select kernel
			this.code.logger.log(`Kernel: opening dropdown to select: ${desiredKernel}`);

			await this.code.driver.page.locator(KERNEL_DROPDOWN).click();
			await this.quickinput.waitForQuickInputOpened();
			await this.code.driver.page.getByText('Select Another Kernel...').click();
			await this.quickinput.selectQuickInputElementContaining(`${kernelGroup} Environments...`);
			await this.quickinput.selectQuickInputElementContaining(desiredKernel);
			await this.quickinput.waitForQuickInputClosed();

			// Wait for kernel initialization
			await expect(this.code.driver.page.locator('.kernel-action-view-item .codicon-modifier-spin')).not.toBeVisible({ timeout: 30000 });
		});
	}

	async createNewNotebook() {
		await this.quickaccess.runCommand(NEW_NOTEBOOK_COMMAND);
	}

	// Opens a Notebook that lives in the current workspace
	async openNotebook(path: string) {
		await test.step(`Open notebook: ${path}`, async () => {
			await this.quickaccess.openFileQuickAccessAndWait(basename(path), 1);
			await this.quickinput.selectQuickInputElement(0);

			await expect(this.code.driver.page.locator(ACTIVE_ROW_SELECTOR)).toBeVisible();
			await this.focusFirstCell();
		});
	}

	async addCodeToFirstCell(code: string) {
		await test.step('Add code to first cell', async () => {
			await this.code.driver.page.locator(CELL_LINE).first().click();
			await this.typeInEditor(code);
			await this.waitForActiveCellEditorContents(code);
		});
	}

	async executeCodeInCell() {
		await test.step('Execute code in cell', async () => {
			await this.quickaccess.runCommand(EXECUTE_CELL_COMMAND);
			await expect(this.code.driver.page.locator(EXECUTE_CELL_SPINNER), 'execute cell spinner to not be visible').not.toBeVisible({ timeout: 30000 });
		});
	}

	async assertCellOutput(text: string): Promise<void> {
		await expect(this.frameLocator.getByText(text)).toBeVisible({ timeout: 15000 });
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
			await expect(stopExecutionLocator).toBeVisible();
			await expect(stopExecutionLocator).not.toBeVisible({ timeout: timeout });
		});
	}

	async focusFirstCell() {
		await this.quickaccess.runCommand('notebook.focusTop');
	}

	async typeInEditor(text: string): Promise<any> {
		await test.step(`Type in editor: ${text}`, async () => {
			const editor = `${ACTIVE_ROW_SELECTOR} .monaco-editor`;

			await this.code.driver.page.locator(editor).isVisible();

			const textarea = `${editor} textarea`;
			await expect(this.code.driver.page.locator(textarea)).toBeFocused();

			await this.code.driver.page.locator(textarea).fill(text);

			await this._waitForActiveCellEditorContents(c => c.indexOf(text) > -1);
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
		if (kind === 'markdown') {
			await this.quickaccess.runCommand('notebook.cell.insertMarkdownCellBelow');
		} else {
			await this.quickaccess.runCommand('notebook.cell.insertCodeCellBelow');
		}
	}

	async stopEditingCell() {
		await this.quickaccess.runCommand('notebook.cell.quitEdit');
	}

	async executeActiveCell(): Promise<void> {
		await this.quickaccess.runCommand('notebook.cell.execute');
	}

	async focusNextCell() {
		await this.code.driver.page.keyboard.press('ArrowDown');
	}
}
