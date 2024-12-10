/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';
import { Notebook } from '../notebook';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';
import { basename } from 'path';
import { expect } from '@playwright/test';

const KERNEL_LABEL = '.kernel-label';
const KERNEL_ACTION = '.kernel-action-view-item';
const SELECT_KERNEL_TEXT = 'Select Kernel';
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
export class PositronNotebooks {
	kernelLabel = this.code.driver.page.locator(KERNEL_LABEL);
	frameLocator = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	notebookProgressBar = this.code.driver.page.locator('[id="workbench\\.parts\\.editor"]').getByRole('progressbar');


	constructor(private code: Code, private quickinput: QuickInput, private quickaccess: QuickAccess, private notebook: Notebook) { }

	async selectInterpreter(kernelGroup: string, desiredKernel: string) {
		await expect(this.notebookProgressBar).not.toBeVisible({ timeout: 30000 });
		await expect(this.code.driver.page.locator(DETECTING_KERNELS_TEXT)).not.toBeVisible({ timeout: 30000 });

		// Wait for either "select kernel" or "the desired kernel" to appear in KERNEL_LABEL
		const kernelRegex = new RegExp(`${SELECT_KERNEL_TEXT}|${desiredKernel}`);
		const kernelLabelLocator = this.code.driver.page.locator(KERNEL_LABEL);
		await expect(kernelLabelLocator).toHaveText(kernelRegex, { timeout: 10000 });

		// Retrieve the matched text for conditional logic
		const matchedText = await kernelLabelLocator.textContent() || '';

		if (!new RegExp(desiredKernel).test(matchedText)) {
			await this.code.driver.page.locator(KERNEL_ACTION).click();
			await this.quickinput.waitForQuickInputOpened();
			await this.quickinput.selectQuickInputElementContaining(kernelGroup);
			await this.quickinput.selectQuickInputElementContaining(desiredKernel);
			await this.quickinput.waitForQuickInputClosed();
		}
	}

	async createNewNotebook() {
		await this.quickaccess.runCommand(NEW_NOTEBOOK_COMMAND);
	}

	// Opens a Notebook that lives in the current workspace
	async openNotebook(path: string) {
		await this.quickaccess.openFileQuickAccessAndWait(basename(path), 1);
		await this.quickinput.selectQuickInputElement(0);

		await this.code.waitForElement(ACTIVE_ROW_SELECTOR);
		await this.notebook.focusFirstCell();
	}

	async addCodeToFirstCell(code: string) {
		await this.code.driver.page.locator(CELL_LINE).first().click();
		await this.notebook.waitForTypeInEditor(code);
		await this.notebook.waitForActiveCellEditorContents(code);
	}

	async executeCodeInCell() {
		await this.quickaccess.runCommand(EXECUTE_CELL_COMMAND);
		await expect(this.code.driver.page.locator(EXECUTE_CELL_SPINNER), 'execute cell spinner to not be visible').not.toBeVisible({ timeout: 30000 });
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
		await this.code.driver.page.getByLabel('Run All').click();
		const stopExecutionLocator = this.code.driver.page.locator('a').filter({ hasText: /Stop Execution|Interrupt/ });
		await expect(stopExecutionLocator).toBeVisible();
		await expect(stopExecutionLocator).not.toBeVisible({ timeout: timeout });
	}
}
