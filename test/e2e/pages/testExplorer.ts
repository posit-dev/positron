/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Explorer } from './explorer';

const TEST_RESULT_ITEM = '.monaco-list-row[aria-level="2"] .test-peek-item';
const NAME = '.name';
const COMPUTED_STATE = '.computed-state';
const TEST_EXPLORER_ICON = '.composite-bar .codicon-test-view-icon';

/*
 *  Reuseable Positron test explorer functionality for tests to leverage.
 */
export class TestExplorer extends Explorer {

	/**
	 * Constructs a object containing test results from the test explorer.
	 * @returns Promise<object> Array of case names with fail/pass statuses.
	 */
	async getTestResults(): Promise<object> {
		const cases = this.code.driver.page.locator(TEST_RESULT_ITEM);
		const caseList = await cases.all();
		const caseStatuses = caseList.map(async aCase => {

			// name is a child of .test-peek-item
			const caseNameLocator = aCase.locator(NAME);

			// computed-state is a child of .test-peek-item
			const caseStatusLocator = aCase.locator(COMPUTED_STATE);

			// Get the class attribute of the computed-state element (all classes)
			const classes = await caseStatusLocator.getAttribute('class');
			let status = 'fail';
			if (classes!.includes('pass')) { // looking specifically for .codicon-testing-passed-icon
				status = 'pass';
			}

			// Get the text of .name, but exclude the text of the child element
			const caseText = await caseNameLocator.evaluate(el => el.firstChild!.textContent);
			return { caseText, status };
		});

		return await Promise.all(caseStatuses);
	}

	/**
	 * Clicks the test explorer icon
	 * @returns Promise<void>
	 */
	async clickTestExplorerIcon(): Promise<void> {
		await this.code.driver.page.locator(TEST_EXPLORER_ICON).click();
	}

	async verifyTestFilesExist(files: string[]) {
		const projectFiles = this.code.driver.page.locator('.test-explorer');

		for (let i = 0; i < files.length; i++) {
			const timeout = i === 0 ? 50000 : undefined;  // 50s for the first check, default for the rest as sometimes waiting for project to load
			await expect(projectFiles.getByLabel(files[i])).toBeVisible({ timeout });
		}
	}

	/**
	 * Clicks to run all tests in the test explorer
	 * @returns Promise<void>
	 */
	async runAllTests(): Promise<void> {
		await this.code.driver.page.locator('.composite.title').getByLabel('Run Tests', { exact: true }).click();
	}
}
