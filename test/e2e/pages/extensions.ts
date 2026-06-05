/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export class Extensions {

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	async searchForExtension(id: string): Promise<void> {
		await this.quickaccess.runCommand('Extensions: Focus on Extensions View', { exactLabelMatch: true });
		await this.code.driver.currentPage.locator('div.extensions-viewlet[id="workbench.view.extensions"] .monaco-editor .native-edit-context').pressSequentially(`@id:${id}`);
		await expect(this.code.driver.currentPage.locator(`div.part.sidebar div.composite.title h2`)).toHaveText('Extensions: Marketplace');

		let retrials = 1;
		while (retrials++ < 10) {
			try {
				const locator = this.code.driver.currentPage.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"]`);
				await expect(locator).toBeVisible();
				return;
			} catch (error) {
				this.code.logger.log(`Extension '${id}' is not found. Retrying count: ${retrials}`);
				await this.quickaccess.runCommand('workbench.extensions.action.refreshExtension');
			}
		}
		throw new Error(`Extension ${id} is not found`);
	}

	/**
	 * Search for an extension by id and open its detail editor.
	 * Asserts the extension editor is visible.
	 */
	async openExtensionDetails(id: string): Promise<void> {
		await this.searchForExtension(id);
		await this.code.driver.currentPage
			.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"]`)
			.click();
		await expect(this.code.driver.currentPage.locator('.extension-editor')).toBeVisible();
	}

	/**
	 * Click the install button on an extension's marketplace list row.
	 * Caller is responsible for searching first. Does not wait for install
	 * to complete (use installExtension for that).
	 */
	async clickInstallButton(id: string): Promise<void> {
		await this.code.driver.currentPage
			.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-action.install`)
			.first()
			.click();
	}

	/**
	 * Untrust a publisher if it's currently trusted; no-op otherwise.
	 * Used to make tests idempotent when exercising the publisher trust
	 * dialog, which only appears for untrusted publishers.
	 */
	async untrustPublisher(publisher: string): Promise<void> {
		const page = this.code.driver.currentPage;
		// keepOpen: running this command immediately opens a second quick pick
		// (the trusted-publishers picker), so the standard "wait for close"
		// after selecting in the command palette would never resolve.
		await this.quickaccess.runCommand('Extensions: Manage Trusted Extension Publishers', { exactLabelMatch: true, keepOpen: true });

		// The picker shows currently-trusted publishers as checkbox rows.
		// If the named publisher isn't trusted, no matching row exists.
		const row = page.locator('.quick-input-widget .quick-input-list .monaco-list-row', { hasText: publisher });
		if (await row.first().isVisible({ timeout: 1000 }).catch(() => false)) {
			await row.first().click(); // toggle off
			await page.locator(`.quick-input-widget .quick-input-action a:has-text('OK')`).click();
		} else {
			await page.keyboard.press('Escape');
		}
	}

	/**
	 * Uninstall an extension if it's currently installed; no-op otherwise.
	 * Searches for the extension first. Used to make tests idempotent when
	 * they need to exercise install-time UI (e.g. publisher trust dialog).
	 */
	async uninstallExtensionIfInstalled(id: string): Promise<void> {
		await this.searchForExtension(id);
		const uninstall = this.code.driver.currentPage.locator(
			`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-action.uninstall`,
		).first();
		if (!(await uninstall.isVisible())) {
			return;
		}
		await uninstall.click();
		const install = this.code.driver.currentPage.locator(
			`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-action.install`,
		).first();
		await expect(install).toBeVisible({ timeout: 30_000 });
	}

	async closeExtension(title: string): Promise<any> {
		try {
			await this.code.driver.currentPage.locator(`.tabs-container div.tab[aria-label="Extension: ${title}, preview"] div.tab-actions a.action-label.codicon.codicon-close`).click();
		} catch (e) {
			this.code.logger.log(`Extension '${title}' not opened as preview. Trying without 'preview'.`);
			await this.code.driver.currentPage.locator(`.tabs-container div.tab[aria-label="Extension: ${title}"] div.tab-actions a.action-label.codicon.codicon-close`).click();
		}
	}

	async installExtension(id: string, waitUntilEnabled: boolean, attemptInstallOnly: boolean = false): Promise<void> {
		await this.searchForExtension(id);
		const locator = this.code.driver.currentPage.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-list-item .monaco-action-bar .action-item:not(.disabled) .extension-action.install`).first();
		await expect(locator).toBeVisible();
		await locator.click();
		if (!attemptInstallOnly) {
			await expect(this.code.driver.currentPage.locator(`.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.uninstall`).first()).toBeVisible();
			if (waitUntilEnabled) {
				await expect(this.code.driver.currentPage.locator(`.extension-editor .monaco-action-bar .action-item:not(.disabled) a[aria-label="Disable this extension"]`)).toBeVisible();
			}
		}
	}

	/**
	 * Install the extension currently shown in the extension editor (details
	 * pane) if it isn't already installed. No-op when the Uninstall button is
	 * present. Used by screenshot tests where we need a stable installed state
	 * regardless of whether the extension shipped pre-installed in the build.
	 */
	async installFromEditorIfNotInstalled(timeout = 60_000): Promise<void> {
		const install = this.code.driver.currentPage
			.locator('.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.install')
			.first();
		const uninstall = this.code.driver.currentPage
			.locator('.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.uninstall')
			.first();
		if (!(await install.isVisible({ timeout: 2_000 }).catch(() => false))) {
			return;
		}
		await install.click();
		await expect(uninstall).toBeVisible({ timeout });
	}
}
