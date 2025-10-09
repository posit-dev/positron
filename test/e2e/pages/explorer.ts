/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const POSITRON_EXPLORER_TITLE = 'div[id="workbench.view.explorer"] h3.title';


/*
 *  Reuseable Positron explorer functionality for tests to leverage.
 */
export class Explorer {
	get explorerTitle(): Locator { return this.code.driver.page.locator(POSITRON_EXPLORER_TITLE); }
	get explorerTitleLocator(): Locator { return this.code.driver.page.locator(POSITRON_EXPLORER_TITLE); }

	constructor(protected code: Code) { }

	async verifyExplorerFilesExist(files: string[]) {
		const explorerFiles = this.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');

		for (let i = 0; i < files.length; i++) {
			const timeout = i === 0 ? 50000 : undefined;  // 50s for the first check, default for the rest as sometimes waiting for the folder to load
			await expect(explorerFiles.getByLabel(files[i], { exact: true }).locator('a')).toBeVisible({ timeout });
		}
	}
}
