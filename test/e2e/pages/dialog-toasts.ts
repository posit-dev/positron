/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Code } from '../infra/code.js';

export class Toasts {

	public toastNotification = this.code.driver.page.locator('.notification-toast');
	public closeButton = this.toastNotification.locator('.codicon-notifications-clear');
	public optionButton = (button: string) => this.toastNotification.getByRole('button', { name: button });

	constructor(private readonly code: Code) { }

	// --- Actions ---

	async waitForAppear(timeout = 20000) {
		await this.toastNotification.waitFor({ state: 'attached', timeout });
	}

	async waitForDisappear(timeout = 20000) {
		await this.toastNotification.waitFor({ state: 'detached', timeout });
	}

	async clickButton(button: string) {
		await test.step(`Click toast button: ${button}`, async () => {
			await this.optionButton(button).click();
		});
	}

	async closeAll() {
		const count = await this.toastNotification.count();
		for (let i = 0; i < count; i++) {
			try {
				await this.toastNotification.nth(i).hover();
				await this.closeButton.nth(i).click();
			} catch {
				this.code.logger.log(`Toast ${i} already closed`);
			}
		}
	}

	async closeWithText(message: string) {
		try {
			const toast = this.toastNotification.filter({ hasText: message });
			await toast.hover();
			await this.closeButton.filter({ hasText: message }).click();
		} catch {
			this.code.logger.log(`Toast "${message}" not found`);
		}
	}

	// --- Verifications ---

	async expectToBeVisible(title?: string | RegExp, timeoutMs = 3000) {
		await test.step(`Verify toast ${title ? `visible: ${title}` : 'visible'}`, async () => {
			if (title) {
				await expect(this.toastNotification.filter({ hasText: title })).toBeVisible({ timeout: timeoutMs });
			} else {
				await expect(this.toastNotification).toBeVisible({ timeout: timeoutMs });
			}
		});
	}

	async expectImportSettingsToastToBeVisible(visible = true) {
		await test.step(`Verify import settings toast is ${visible ? '' : 'NOT'} visible`, async () => {
			const buttons = [
				this.toastNotification.getByRole('button', { name: 'Compare settings' }),
				this.toastNotification.getByRole('button', { name: 'Later' }),
				this.toastNotification.getByRole('button', { name: "Don't Show Again" }),
			];

			for (const btn of buttons) {
				visible ? await expect(btn).toBeVisible() : await expect(btn).not.toBeVisible();
			}
		});
	}

	async expectNotToBeVisible(timeoutMs = 3000) {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await this.toastNotification.count() > 0) {
				throw new Error('Toast appeared unexpectedly');
			}
			await this.code.driver.page.waitForTimeout(1000);
		}
	}

	async awaitToastDisappearance(timeoutMs = 3000) {
		await expect(this.toastNotification).toHaveCount(0, { timeout: timeoutMs });
	}

}
