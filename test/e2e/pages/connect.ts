/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code.js';
export class PositConnect {

	constructor(private code: Code) {
		this.code = code;
	}
	async deleteUserContent() {
		if (!process.env.E2E_CONNECT_SERVER || !process.env.E2E_CONNECT_APIKEY) {
			throw new Error('Missing E2E_CONNECT_SERVER or E2E_CONNECT_APIKEY env vars.');
		}
		const connectApiUrl = `${process.env.E2E_CONNECT_SERVER}__api__/v1/`
		const headers = { 'Authorization': `Key ${process.env.E2E_CONNECT_APIKEY}` };
		const userGuid = (await (await fetch(connectApiUrl + 'user', { headers: headers })).json()).guid;

		const appInfo = await (await fetch(connectApiUrl + `content?owner_guid=${userGuid}`, { headers: headers })).json();

		for (const app of appInfo) {
			const guid = app.guid as string;

			const response = await fetch(`${connectApiUrl}content/${guid}`, {
				method: 'DELETE',
				headers,
			});

			if (response.status !== 204) {
				throw new Error(`Failed to delete content with GUID: ${guid}`);
			}
		}
	}

	async selectFilesForDeploy(files: string[]) {
		const editorContainer = this.code.driver.page.locator('[id="workbench.parts.editor"]');
		const dynamicTomlLineRegex = /deployment-.*?\.toml/;
		const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });

		await targetLine.scrollIntoViewIfNeeded({ timeout: 20000 });
		await expect(targetLine).toBeVisible({ timeout: 10000 });

		await targetLine.click();
		await this.code.driver.page.keyboard.press('End');
		await this.code.driver.page.keyboard.type(',');

		for (const file of files) {
			await this.code.driver.page.keyboard.press('Enter');
			await this.code.driver.page.keyboard.type(`'/${file}'${file === files[files.length - 1] ? '' : ','}`);
		}

		const saveButton = this.code.driver.page.locator('.action-bar-button-icon.codicon.codicon-positron-save').first();
		await saveButton.click();
	}
}
