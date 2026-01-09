/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export class Extensions {

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	async searchForExtension(id: string): Promise<void> {
		await this.quickaccess.runCommand('Extensions: Focus on Extensions View', { exactLabelMatch: true });
		await this.code.driver.page.locator('div.extensions-viewlet[id="workbench.view.extensions"] .monaco-editor .native-edit-context').pressSequentially(`@id:${id}`);
		await expect(this.code.driver.page.locator(`div.part.sidebar div.composite.title h2`)).toHaveText('Extensions: Marketplace');

		let retrials = 1;
		while (retrials++ < 10) {
			try {
				const locator = this.code.driver.page.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"]`);
				await expect(locator).toBeVisible();
				return;
			} catch (error) {
				this.code.logger.log(`Extension '${id}' is not found. Retrying count: ${retrials}`);
				await this.quickaccess.runCommand('workbench.extensions.action.refreshExtension');
			}
		}
		throw new Error(`Extension ${id} is not found`);
	}

	async closeExtension(title: string): Promise<any> {
		try {
			await this.code.driver.page.locator(`.tabs-container div.tab[aria-label="Extension: ${title}, preview"] div.tab-actions a.action-label.codicon.codicon-close`).click();
		} catch (e) {
			this.code.logger.log(`Extension '${title}' not opened as preview. Trying without 'preview'.`);
			await this.code.driver.page.locator(`.tabs-container div.tab[aria-label="Extension: ${title}"] div.tab-actions a.action-label.codicon.codicon-close`).click();
		}
	}

	async installExtension(id: string, waitUntilEnabled: boolean, attemptInstallOnly: boolean = false): Promise<void> {
		await this.searchForExtension(id);
		const locator = this.code.driver.page.locator(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-list-item .monaco-action-bar .action-item:not(.disabled) .extension-action.install`).first();
		await expect(locator).toBeVisible();
		await locator.click();
		if (!attemptInstallOnly) {
			await expect(this.code.driver.page.locator(`.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.uninstall`).first()).toBeVisible();
			if (waitUntilEnabled) {
				await expect(this.code.driver.page.locator(`.extension-editor .monaco-action-bar .action-item:not(.disabled) a[aria-label="Disable this extension"]`)).toBeVisible();
			}
		}
	}


}
