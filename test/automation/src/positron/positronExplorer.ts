/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
// import { QuickAccess } from '../quickaccess';
import { PositronTextElement } from './positronBaseElement';

const POSITRON_EXPLORER_PROJECT_TITLE = 'div[id="workbench.view.explorer"] h3.title';
const POSITRON_EXPLORER_PROJECT_FILES = 'div[id="workbench.view.explorer"] span[class="monaco-highlighted-label"]';


/*
 *  Reuseable Positron explorer functionality for tests to leverage.
 */
export class PositronExplorer {
	explorerProjectTitle: PositronTextElement;

	constructor(private code: Code) {
		this.explorerProjectTitle = new PositronTextElement(POSITRON_EXPLORER_PROJECT_TITLE, this.code);
	}

	/**
	 * Constructs a string array of the top-level project files/directories in the explorer.
	 * @returns Promise<string[]> Array of strings representing the top-level project files/directories in the explorer.
	 */
	async getExplorerProjectFiles() {
		const explorerProjectFiles = this.code.driver.getLocator(POSITRON_EXPLORER_PROJECT_FILES);
		const filesList = await explorerProjectFiles.all();
		const fileNames = filesList.map(async file => {
			const fileText = await file.textContent();
			return fileText || '';
		});
		return await Promise.all(fileNames);
	}

	async waitForProjectFileToAppear(filename: string) {
		const escapedFilename = filename.replace(/\./g, '\\.').toLowerCase();
		await this.code.waitForElement(`.${escapedFilename}-name-file-icon`);
	}
}
