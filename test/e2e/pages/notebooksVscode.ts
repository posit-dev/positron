/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Notebooks } from './notebooks';
import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { QuickAccess } from './quickaccess';
import test, { expect, Locator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';

/**
 * Notebooks functionality exclusive to VS Code notebooks.
 */
export class VsCodeNotebooks extends Notebooks {
	startChatButton: Locator;

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		super(code, quickinput, quickaccess, hotKeys);

		this.startChatButton = this.code.driver.page.getByLabel(/Start Chat to Generate Code/).first();
	}

	/**
	 * Verify: a VS Code notebook is visible on the page.
	 */
	async expectToBeVisible(timeout = 5000): Promise<void> {
		await test.step('Verify VS Code notebook is visible', async () => {
			await expect(this.startChatButton).toBeVisible({ timeout });
		});
	}
}
