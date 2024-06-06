/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { QuickInput } from '../quickinput';

const KERNEL_LABEL = '.kernel-label';
const KERNEL_ACTION = '.kernel-action-view-item';
const SELECT_KERNEL_TEXT = 'Select Kernel';
const NEW_NOTEBOOK_COMMAND = 'ipynb.newUntitledIpynb';
const EDIT_CELL_COMMAND = 'notebook.cell.edit';
const EXECUTE_CELL_COMMAND = 'notebook.cell.execute';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const PYTHON_OUTPUT = '.output-plaintext';
const R_OUTPUT = '.output_container .output';
const REVERT_AND_CLOSE = 'workbench.action.revertAndCloseActiveEditor';

export class PositronNotebooks {

	constructor(private code: Code, private quickinput: QuickInput, private quickaccess: QuickAccess) { }

	async selectInterpreter(kernelGroup: string, desiredKernel: string) {
		await this.code.waitForElement(KERNEL_LABEL, (e) => e!.textContent.includes(desiredKernel) || e!.textContent.includes(SELECT_KERNEL_TEXT));

		const interpreterManagerText = (await this.code.waitForElement(KERNEL_LABEL)).textContent;
		if (interpreterManagerText === SELECT_KERNEL_TEXT) {
			await this.code.waitAndClick(KERNEL_ACTION);
			await this.quickinput.waitForQuickInputOpened();
			// depending on random timing, it may or may not be necessary to select the kernel group
			try {
				await this.quickinput.selectQuickInputElementContaining(kernelGroup);
			} catch {
				console.log('Kernel group not found');
			}
			await this.quickinput.selectQuickInputElementContaining(desiredKernel);
			await this.quickinput.waitForQuickInputClosed();
		}
	}

	async createNewNotebook() {
		await this.quickaccess.runCommand(NEW_NOTEBOOK_COMMAND);
	}

	async executeInFirstCell(code: string) {
		await this.quickaccess.runCommand(EDIT_CELL_COMMAND);
		// no locator-less type method in Microsoft base functionality
		await this.code.driver.getKeyboard().type(code);
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
}
