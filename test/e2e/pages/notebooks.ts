/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { QuickAccess } from './quickaccess';
import { basename } from 'path';
import test, { expect, FrameLocator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';

const NEW_NOTEBOOK_COMMAND = 'ipynb.newUntitledIpynb';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REVERT_AND_CLOSE = 'workbench.action.revertAndCloseActiveEditor';

/*
 * Shared Notebooks functionality for both Vscode and Positron notebooks.
 */
export class Notebooks {
	protected code: Code;
	protected quickinput: QuickInput;
	protected quickaccess: QuickAccess;
	protected hotKeys: HotKeys;

	frameLocator: FrameLocator;

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		this.code = code;
		this.quickinput = quickinput;
		this.quickaccess = quickaccess;
		this.hotKeys = hotKeys;

		this.frameLocator = this.code.driver.currentPage.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	}

	async createNewNotebook() {
		await this.quickaccess.runCommand(NEW_NOTEBOOK_COMMAND);
	}

	// Opens a Notebook that lives in the current workspace
	async openNotebook(path: string) {
		await test.step(`Open notebook: ${path}`, async () => {
			await this.quickaccess.openFileQuickAccessAndWait(basename(path), 1);
			await this.quickinput.selectQuickInputElement(0);
			await expect(this.code.driver.currentPage.locator('.cell').first()).toBeVisible({ timeout: 60000 });
			await expect(this.code.driver.currentPage.getByText('Detecting Kernels')).not.toBeVisible({ timeout: 30000 });
			await this.focusFirstCell();
		});
	}

	async closeNotebookWithoutSaving() {
		await this.quickaccess.runCommand(REVERT_AND_CLOSE);
	}

	async runAllCells({ timeout = 15000 } = {}): Promise<void> {
		await test.step('Run all cells', async () => {
			await this.code.driver.currentPage.getByLabel('Run All').click();
			const stopExecutionLocator = this.code.driver.currentPage.locator('a').filter({ hasText: /Stop Execution|Interrupt/ });
			try {
				await expect(stopExecutionLocator).toBeVisible({ timeout });
				await expect(stopExecutionLocator).not.toBeVisible({ timeout });
			} catch { } // can be normal with very fast execution
		});
	}

	async focusFirstCell() {
		await this.quickaccess.runCommand('notebook.focusTop');
	}
}
