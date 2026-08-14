/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
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

	// --- Actions ---

	async clickButton(label: string | RegExp): Promise<void> {
		await test.step(`Click button in dynamic modal: ${label}`, async () => {
			await this.getButton(label).click();
		});
	}

	async clickCloseButton(): Promise<void> {
		await test.step('Click close button in dynamic modal', async () => {
			await this.closeButton.click();
		});
	}

	async pressEscape(): Promise<void> {
		await test.step('Press Escape to dismiss dynamic modal', async () => {
			await this.code.driver.currentPage.keyboard.press('Escape');
		});
	}

	// --- Verifications ---

	async expectToBeVisible(title?: string | RegExp, { timeout = 15000 } = {}): Promise<void> {
		await test.step(`Verify dynamic modal is visible${title ? `: ${title}` : ''}`, async () => {
			await expect(this.dialogBox).toBeVisible({ timeout });
			if (title) {
				await expect(this.title).toHaveText(title, { timeout });
			}
		});
	}

	async expectNotToBeVisible({ timeout = 5000 } = {}): Promise<void> {
		await test.step('Verify dynamic modal is not visible', async () => {
			await expect(this.dialogBox).not.toBeVisible({ timeout });
		});
	}

	async expectMessageToContain(text: string | RegExp): Promise<void> {
		await test.step(`Verify dynamic modal message contains: ${text}`, async () => {
			await expect(this.message).toContainText(text);
		});
	}

	async expectButtonsToBeVisible(labels: (string | RegExp)[]): Promise<void> {
		await test.step(`Verify dynamic modal buttons: ${labels.join(', ')}`, async () => {
			for (const label of labels) {
				await expect(this.getButton(label)).toBeVisible();
			}
		});
	}
}
