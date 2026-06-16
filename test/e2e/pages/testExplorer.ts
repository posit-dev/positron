/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Explorer } from './explorer';

const TEST_EXPLORER_ICON = '.composite-bar .codicon-test-view-icon';

/*
 *  Reuseable Positron test explorer functionality for tests to leverage.
 */
export class TestExplorer extends Explorer {

	async openTestExplorer(): Promise<void> {
		const locator = this.code.driver.currentPage.locator(TEST_EXPLORER_ICON);
		await locator.waitFor({ state: 'attached' });
		await locator.waitFor({ state: 'visible' });
		await locator.click();
	}

	async expectTestItems(labels: string[]): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		for (const label of labels) {
			await expect(tree.getByLabel(label)).toBeVisible({ timeout: 3000 });
		}
	}

	async runAllTests(): Promise<void> {
		await this.code.driver.currentPage.locator('.composite.title').getByLabel('Run Tests', { exact: true }).click();
	}

	async expandAllTests(): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		const collapsed = tree.locator('.monaco-list-row[aria-expanded="false"]');

		// Technically we just expand up to 100 items, so raise this cap if we
		// ever create a test fixture that requires more expansion.
		const MAX_EXPAND_ATTEMPTS = 100;
		for (let attempt = 0; attempt < MAX_EXPAND_ATTEMPTS && await collapsed.count() > 0; attempt++) {
			await collapsed.first().locator('.monaco-tl-twistie').click();
		}
	}

	// State is encoded in the accessible label as "<label> (<state>)"; substring match ignores the trailing ", in <duration>".
	async expectTestStatus(label: string, state: 'Passed' | 'Failed' | 'Errored' | 'Skipped', timeout?: number): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		await expect(tree.getByLabel(`${label} (${state})`)).toBeVisible({ timeout });
	}
}
