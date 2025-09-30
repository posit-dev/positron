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

type ServerSettingsResponse = {
	installations?: Array<{ version?: string }>;
	api_enabled?: boolean;
};

const apiServer = 'http://localhost:3939/__api__/v1/';

export class PositConnect {

	private headers: Record<string, string>;
	private connectApiKey: string;

	constructor(private code: Code) {
		this.code = code;
		this.headers = {};
		this.connectApiKey = '';
	}

	setConnectApiKey(key: string) {
		this.connectApiKey = key;
		this.headers['Authorization'] = `Key ${this.connectApiKey}`;
	}

	getConnectApiKey() {
		return this.connectApiKey;
	}

	// Create a new user and return the user guid
	// Note: This function does not check for existing users with the same username/email
	// It is the caller's responsibility to ensure uniqueness if needed

	async createUser(): Promise<string> {
		const body: CreateUserBody = {
			email: 'john_doe@posit.co',
			first_name: 'John',
			last_name: 'Doe',
			password: process.env.POSIT_WORKBENCH_PASSWORD || 'dummy',
			user_role: 'viewer',
			username: 'user1',
		};

		const res = await fetch(`${apiServer}users`, {
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


	async getPythonVersions(): Promise<string[]> {
		const res = await fetch(`${apiServer}server_settings/python`, {
			headers: this.headers
		});
		if (!res.ok) { throw new Error(`HTTP ${res.status} ${res.statusText}`); }

		const data = (await res.json()) as ServerSettingsResponse;
		return Array.from(
			new Set((data.installations ?? []).map(i => i.version).filter((v): v is string => !!v))
		);
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
