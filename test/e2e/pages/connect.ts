/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code.js';

type CreateUserBody = {
	email: string;
	first_name: string;
	last_name: string;
	password: string;
	user_role: 'viewer' | 'publisher' | 'administrator';
	username: string;
};

type CreateUserResponse = {
	email: string;
	username: string;
	first_name: string;
	last_name: string;
	user_role: string;
	created_time: string;
	updated_time: string;
	active_time: string | null;
	confirmed: boolean;
	locked: boolean;
	guid: string;
};

export class PositConnect {

	private connectApiUrl: string;
	private headers: Record<string, string>;
	private connectApiKey: string;

	constructor(private code: Code) {
		this.code = code;
		this.connectApiUrl = `${process.env.E2E_CONNECT_SERVER}__api__/v1/`;
		this.headers = {};
		this.connectApiKey = '';
	}

	setConnectApiKey(key: string) {
		this.connectApiKey = key;
		this.headers['Authorization'] = `Key ${this.connectApiKey}`;
	}

	async createUser(): Promise<string> {
		const body: CreateUserBody = {
			email: 'john_doe@posit.co',
			first_name: 'John',
			last_name: 'Doe',
			password: process.env.POSIT_WORKBENCH_PASSWORD || 'dummy',
			user_role: 'viewer',
			username: 'user1',
		};

		const res = await fetch('http://localhost:3939/__api__/v1/users', {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`Request failed: ${res.status} ${res.statusText}\n${text}`);
		}

		// If the server returns JSON, this will parse it.
		const data = (await res.json()) as CreateUserResponse;

		// Return the guid
		return data.guid;
	}


	async deleteUserContent() {
		if (!process.env.E2E_CONNECT_SERVER || !process.env.E2E_CONNECT_APIKEY) {
			throw new Error('Missing E2E_CONNECT_SERVER or E2E_CONNECT_APIKEY env vars.');
		}

		const userGuid = await this.getUser();

		const appInfo = await (await fetch(this.connectApiUrl + `content?owner_guid=${userGuid}`, { headers: this.headers })).json();

		for (const app of appInfo) {
			const guid = app.guid as string;

			const response = await fetch(`${this.connectApiUrl}content/${guid}`, {
				method: 'DELETE',
				headers: this.headers,
			});

			if (response.status !== 204) {
				throw new Error(`Failed to delete content with GUID: ${guid}`);
			}
		}
	}

	async getUser(): Promise<string> {
		if (!process.env.E2E_CONNECT_SERVER || !process.env.E2E_CONNECT_APIKEY) {
			throw new Error('Missing E2E_CONNECT_SERVER or E2E_CONNECT_APIKEY env vars.');
		}

		const userGuid = (await (await fetch(this.connectApiUrl + 'user', { headers: this.headers })).json()).guid;
		return userGuid;
	}

	// To prevent flakiness, this function always add the file name after app.py, which is guaranteed to be present
	async selectFilesForDeploy(files: string[]) {
		const editorContainer = this.code.driver.page.locator('[id="workbench.parts.editor"]');
		const dynamicTomlLineRegex = 'app.py';
		const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });

		await targetLine.scrollIntoViewIfNeeded({ timeout: 20000 });
		await expect(targetLine).toBeVisible({ timeout: 10000 });

		await targetLine.click();
		await this.code.driver.page.keyboard.press('End');

		for (let i = 0; i < files.length; i++) {
			if (i > 0) {
				await this.code.driver.page.keyboard.press('Enter');
			}
			await this.code.driver.page.keyboard.type(`'/${files[i]}',`);
		}
		const saveButton = this.code.driver.page.locator('.action-bar-button-icon.codicon.codicon-positron-save').first();
		await saveButton.click();
	}
}
