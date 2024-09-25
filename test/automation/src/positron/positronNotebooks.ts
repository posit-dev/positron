/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../code';
import { Notebook } from '../notebook';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';
import { basename } from 'path';

const KERNEL_LABEL = '.kernel-label';
const KERNEL_ACTION = '.kernel-action-view-item';
const SELECT_KERNEL_TEXT = 'Select Kernel';
const DETECTING_KERNELS_TEXT = 'Detecting Kernels';
const NEW_NOTEBOOK_COMMAND = 'ipynb.newUntitledIpynb';
const EDIT_CELL_COMMAND = 'notebook.cell.edit';
const EXECUTE_CELL_COMMAND = 'notebook.cell.execute';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const PYTHON_OUTPUT = '.output-plaintext';
const R_OUTPUT = '.output_container .output';
const REVERT_AND_CLOSE = 'workbench.action.revertAndCloseActiveEditor';
const MARKDOWN_TEXT = '#preview';
const ACTIVE_ROW_SELECTOR = `.notebook-editor .monaco-list-row.focused`;

/*
 *  Reuseable Positron notebook functionality for tests to leverage.  Includes selecting the notebook's interpreter.
 */
export class PositronNotebooks {
	kernelLabel = this.code.driver.getLocator(KERNEL_LABEL);

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

		// Attempt to add code to a cell.  If the code is not added correctly, delete the cell and try
		// again for up to 60 seconds
		await expect(async () => {
			try {
				await this.quickaccess.runCommand(EDIT_CELL_COMMAND);
				await this.notebook.waitForTypeInEditor(code);
				await this.notebook.waitForActiveCellEditorContents(code);
			} catch (e) {
				await this.notebook.deleteActiveCell();
				throw e;
			}
		}).toPass({ timeout: 60000 });
	}

	async executeCodeInCell() {
		await this.quickaccess.runCommand(EXECUTE_CELL_COMMAND);
	}

	async getPythonCellOutput(): Promise<string> {
		// basic CSS selection doesn't support frames (or nested frames)
		const notebookFrame = this.code.driver.getFrame(OUTER_FRAME).frameLocator(INNER_FRAME);
		const outputLocator = notebookFrame.locator(PYTHON_OUTPUT);
		const outputText = await outputLocator.textContent();
		return outputText!;
	}

	async getRCellOutput(): Promise<string> {
		// basic CSS selection doesn't support frames (or nested frames)
		const notebookFrame = this.code.driver.getFrame(OUTER_FRAME).frameLocator(INNER_FRAME);
		const outputLocator = notebookFrame.locator(R_OUTPUT).nth(0);
		const outputText = await outputLocator.textContent();
		return outputText!;
	}

	async closeNotebookWithoutSaving() {
		await this.quickaccess.runCommand(REVERT_AND_CLOSE);
	}

	async getMarkdownText(tag: string): Promise<string> {
		// basic CSS selection doesn't support frames (or nested frames)
		const frame = this.code.driver.getFrame(OUTER_FRAME).frameLocator(INNER_FRAME);
		const element = frame.locator(`${MARKDOWN_TEXT} ${tag}`);
		const text = await element.textContent();
		return text!;
	}
}
