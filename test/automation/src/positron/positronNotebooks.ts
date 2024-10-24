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
const INNER_FRAME = '#active-frame';
const REVERT_AND_CLOSE = 'workbench.action.revertAndCloseActiveEditor';
const MARKDOWN_TEXT = '#preview';
const ACTIVE_ROW_SELECTOR = `.notebook-editor .monaco-list-row.focused`;


/*
 *  Reuseable Positron notebook functionality for tests to leverage.  Includes selecting the notebook's interpreter.
 */
export class PositronNotebooks {
	kernelLabel = this.code.driver.getLocator(KERNEL_LABEL);
	frameLocator = this.code.driver.page.frameLocator('iframe').frameLocator(INNER_FRAME);

	constructor(private code: Code, private quickinput: QuickInput, private quickaccess: QuickAccess, private notebook: Notebook) { }

	async selectInterpreter(kernelGroup: string, desiredKernel: string) {

		// get the kernel label text
		let interpreterManagerText = (await this.code.waitForElement(KERNEL_LABEL)).textContent;

		// if we are still detecting kernels, wait extra time for the correct kernel or for the
		// "Select Kernel" option to appear
		if (interpreterManagerText === DETECTING_KERNELS_TEXT) {
			interpreterManagerText = (await this.code.waitForElement(KERNEL_LABEL, (e) =>
				e!.textContent.includes(desiredKernel) ||
				e!.textContent.includes(SELECT_KERNEL_TEXT), 600)).textContent;
		}

		// if select kernel appears, select the proper kernel
		// also if the wrong kernel has shown up, select the proper kernel
		if (interpreterManagerText === SELECT_KERNEL_TEXT || !interpreterManagerText.includes(desiredKernel)) {
			await this.code.waitAndClick(KERNEL_ACTION);
			await this.quickinput.waitForQuickInputOpened();
			// depending on random timing, it may or may not be necessary to select the kernel group
			try {
				await this.quickinput.selectQuickInputElementContaining(kernelGroup);
			} catch {
				this.code.logger.log('Kernel group not found');
			}
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
		await expect(this.code.driver.page.locator(EXECUTE_CELL_SPINNER)).not.toBeVisible({ timeout: 30000 });
	}

	async assertCellOutput(text: string): Promise<void> {
		await expect(this.frameLocator.getByText(text)).toBeVisible();
	}

	async closeNotebookWithoutSaving() {
		await this.quickaccess.runCommand(REVERT_AND_CLOSE);
	}

	async assertMarkdownText(tag: string, expectedText: string): Promise<void> {
		const markdownLocator = this.frameLocator.locator(`${MARKDOWN_TEXT} ${tag}`);
		await expect(markdownLocator).toHaveText(expectedText);
	}
}
