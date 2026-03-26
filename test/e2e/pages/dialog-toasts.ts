/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code.js';

export class Toasts {

	public get toastNotification(): Locator { return this.code.driver.currentPage.locator('.notification-toast'); }
	public get notificationsCenter(): Locator { return this.code.driver.currentPage.locator('.notifications-center'); }
	public get closeButton(): Locator { return this.toastNotification.locator('.codicon-notifications-clear'); }
	public getOptionButton(button: string): Locator { return this.toastNotification.getByRole('button', { name: button }); }

	constructor(private readonly code: Code) { }

	/**
	 * Opens the notification center. In smoke test mode, toasts are disabled
	 * so notifications only appear in the notification center.
	 */
	async openNotificationCenter() {
		await test.step('Open notification center', async () => {
			// Check if already open
			if (await this.notificationsCenter.isVisible()) {
				return;
			}
			// Use the keybinding to show notifications center: Cmd+K Cmd+Shift+N (Mac) / Ctrl+K Ctrl+Shift+N (Win/Linux)
			const page = this.code.driver.currentPage;
			const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
			await page.keyboard.press(`${modifier}+K`);
			await page.keyboard.press(`${modifier}+Shift+N`);
			await expect(this.notificationsCenter).toBeVisible({ timeout: 5000 });
		});
	}

	/**
	 * Closes the notification center if it's open.
	 */
	async closeNotificationCenter() {
		await test.step('Close notification center', async () => {
			if (await this.notificationsCenter.isVisible()) {
				await this.code.driver.currentPage.keyboard.press('Escape');
				await expect(this.notificationsCenter).not.toBeVisible({ timeout: 5000 });
			}
		});
	}

	// --- Actions ---

	async waitForAppear(title?: string | RegExp, { timeout = 20000 } = {}) {
		title
			? await this.toastNotification.getByText(title).waitFor({ state: 'attached', timeout })
			: await this.toastNotification.waitFor({ state: 'attached', timeout });
	}

	async waitForDisappear(title?: string | RegExp, { timeout = 20000 } = {}) {
		title
			? await this.toastNotification.getByText(title).waitFor({ state: 'detached', timeout })
			: await this.toastNotification.waitFor({ state: 'detached', timeout });
	}

	async clickButton(button: string) {
		await test.step(`Click notification button: ${button}`, async () => {
			// Try notification center first (for smoke test mode where toasts are disabled)
			const notificationCenterButton = this.notificationsCenter.getByRole('button', { name: button });
			if (await this.notificationsCenter.isVisible() && await notificationCenterButton.isVisible()) {
				await notificationCenterButton.click();
				// Close notification center after clicking to ensure clean state
				await this.closeNotificationCenter();
			} else {
				// Fall back to toast notification
				await this.getOptionButton(button).click();
			}
		});
	}

	async closeAll() {
		const count = await this.toastNotification.count();
		for (let i = 0; i < count; i++) {
			try {
				await this.toastNotification.nth(i).hover({ timeout: 5000 });
				await this.closeButton.nth(i).click({ timeout: 5000 });
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
			this.code.logger.log('Toast "${message}" not found');
		}
	}

	async closeWithHeader(header: string | RegExp) {
		const toast = this.toastNotification.filter({ hasText: header });
		await toast.hover();
		await toast.locator('.codicon-notifications-clear').click();
	}

	// --- Verifications ---

	async expectToastWithTitle(title?: string | RegExp, timeoutMs = 3000) {
		await test.step(`Verify toast ${title ? `visible: ${title}` : 'visible'}`, async () => {
			if (title) {
				await expect(this.toastNotification.filter({ hasText: title })).toBeVisible({ timeout: timeoutMs });
			} else {
				await expect(this.toastNotification).toBeVisible({ timeout: timeoutMs });
			}
		});
	}

	async expectToastWithTitleNotToAppear(title: string | RegExp, timeoutMs = 5000) {
		await test.step(`Verify toast not visible: ${title}`, async () => {
			await expect(this.toastNotification.filter({ hasText: title })).not.toBeVisible({ timeout: timeoutMs });
		});
	}

	async expectImportSettingsToastToBeVisible(visible = true) {
		await test.step(`Verify import settings notification is ${visible ? '' : 'NOT'} visible`, async () => {
			// In smoke test mode, toasts are disabled. Notifications go to the notification center.
			// Open the notification center to check for the import settings notification.
			await this.openNotificationCenter();

			const importSettingsNotification = this.notificationsCenter.locator('.notification-list-item').filter({
				hasText: /Import your settings from Visual Studio Code/
			});

			if (visible) {
				await expect(importSettingsNotification).toBeVisible({ timeout: 10000 });

				const buttons = [
					importSettingsNotification.getByRole('button', { name: 'Compare settings' }),
					importSettingsNotification.getByRole('button', { name: 'Later' }),
					importSettingsNotification.getByRole('button', { name: "Don't show again" }),
				];

				for (const btn of buttons) {
					await expect(btn).toBeVisible();
				}
				// Keep notification center open so buttons can be clicked
			} else {
				await expect(importSettingsNotification).not.toBeVisible({ timeout: 5000 });
				// Close notification center when we're done checking
				await this.closeNotificationCenter();
			}
		});
	}

	async expectNotToBeVisible(timeoutMs = 3000) {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await this.toastNotification.count() > 0) {
				throw new Error('Toast appeared unexpectedly');
			}
			await this.code.driver.currentPage.waitForTimeout(1000);
		}
	}

	async awaitToastDisappearance(timeoutMs = 3000) {
		await expect(this.toastNotification).toHaveCount(0, { timeout: timeoutMs });
	}

}
