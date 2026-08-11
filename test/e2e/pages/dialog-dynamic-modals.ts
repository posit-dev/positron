/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code.js';

/**
 * Positron's dynamic modal dialog, the one `PositronDynamicModalDialog` renders. Distinct
 * from `Modals`, which drives the older `.positron-modal-dialog-box`; the two class names
 * do not overlap, so a `Modals` locator will not find this dialog.
 */
export class DynamicModals {

	constructor(private code: Code) { }

	get dialogBox(): Locator {
		return this.code.driver.currentPage.locator('.positron-dynamic-modal-dialog-box');
	}
	get title(): Locator { return this.dialogBox.locator('.title-bar-title'); }
	get message(): Locator { return this.dialogBox.locator('.content-area'); }
	get closeButton(): Locator { return this.dialogBox.locator('.title-bar-close-button'); }

	getButton(label: string | RegExp): Locator {
		return this.dialogBox.getByRole('button', { name: label });
	}

	async clickButton(label: string | RegExp): Promise<void> {
		await this.getButton(label).click();
	}

	async pressEscape(): Promise<void> {
		await this.code.driver.currentPage.keyboard.press('Escape');
	}

	async expectToBeVisible(timeout = 15000): Promise<void> {
		await expect(this.dialogBox).toBeVisible({ timeout });
	}

	async expectNotToBeVisible(timeout = 5000): Promise<void> {
		await expect(this.dialogBox).not.toBeVisible({ timeout });
	}
}
