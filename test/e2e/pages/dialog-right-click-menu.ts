/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code.js';

export class RightClickMenu {
	constructor(private readonly code: Code) { }

	async triggerAndSelect(locator: Locator, action: 'Select All' | 'Copy' | 'Paste') {
		await locator.click({ button: 'right' });

		const menu = this.code.driver.page.locator('.monaco-menu');

		for (let i = 0; i < 4; i++) {
			try {
				await menu.locator(`[aria-label="${action}"]`).click();
				await expect(menu).toBeHidden({ timeout: 2000 });
				break;
			} catch {
				await this.code.driver.page.waitForTimeout(250);
			}
		}
	}
}
