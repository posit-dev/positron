/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

const POSITRON_EXPLORER_TITLE = 'div[id="workbench.view.explorer"] h3.title';


/*
 *  Reuseable Positron explorer functionality for tests to leverage.
 */
export class Explorer {
	get explorerTitle(): Locator { return this.code.driver.currentPage.locator(POSITRON_EXPLORER_TITLE); }
	get explorerTitleLocator(): Locator { return this.code.driver.currentPage.locator(POSITRON_EXPLORER_TITLE); }

	constructor(protected code: Code, protected quickaccess: QuickAccess) { }

	/**
	 * Assert that each named file is present in the Explorer.
	 *
	 * Collapses the tree first. The Explorer's list is virtualized, so a row
	 * outside the rendered window is absent from the DOM entirely rather than
	 * merely scrolled out of sight -- which makes this assertion fail with
	 * "element(s) not found" and no possibility of recovery. Whether a given row
	 * is inside that window depends on how many folders happen to be expanded,
	 * and the `app` fixture is worker-scoped, so expansion state accumulates
	 * across every test that ran before this one in the same session. Collapsing
	 * makes the check depend only on the file actually existing.
	 */
	async verifyExplorerFilesExist(files: string[]) {
		await this.quickaccess.runCommand('workbench.files.action.collapseExplorerFolders');

		const explorerFiles = this.code.driver.currentPage.locator('.monaco-list > .monaco-scrollable-element');

		for (let i = 0; i < files.length; i++) {
			const timeout = i === 0 ? 50000 : undefined;  // 50s for the first check, default for the rest as sometimes waiting for the folder to load
			await expect(explorerFiles.getByLabel(files[i], { exact: true }).locator('a')).toBeVisible({ timeout });
		}
	}
}
