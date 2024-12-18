/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../code';

const POSITRON_EXPLORER_PROJECT_TITLE = 'div[id="workbench.view.explorer"] h3.title';
const POSITRON_EXPLORER_PROJECT_FILES = 'div[id="workbench.view.explorer"] span[class="monaco-highlighted-label"]';


/*
 *  Reuseable Positron explorer functionality for tests to leverage.
 */
export class PositronExplorer {
	explorerProjectTitle: Locator = this.code.driver.page.locator(POSITRON_EXPLORER_PROJECT_TITLE);
	explorerProjectTitleLocator = this.code.driver.page.locator(POSITRON_EXPLORER_PROJECT_TITLE);

	constructor(protected code: Code) { }

	/**
	 * Constructs a string array of the top-level project files/directories in the explorer.
	 * @param locator - The locator for the project files/directories in the explorer.
	 * @returns Promise<string[]> Array of strings representing the top-level project files/directories in the explorer.
	 */
	async getExplorerProjectFiles(locator: string = POSITRON_EXPLORER_PROJECT_FILES): Promise<string[]> {
		const explorerProjectFiles = this.code.driver.getLocator(locator);
		const filesList = await explorerProjectFiles.all();
		const fileNames = filesList.map(async file => {
			const fileText = await file.textContent();
			return fileText || '';
		});
		return await Promise.all(fileNames);
	}

	async waitForProjectFileToAppear(filename: string) {
		const escapedFilename = filename.replace(/\./g, '\\.').toLowerCase();
		await expect(this.code.driver.page.locator(`.${escapedFilename}-name-file-icon`)).toBeVisible({ timeout: 30000 });
	}
}
