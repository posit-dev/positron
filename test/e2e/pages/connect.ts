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

type ConnectUser = {
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

type UsersResponse = {
	results: ConnectUser[];
	current_page: number;
	total: number;
};

export interface PermissionPayload {
	principal_guid: string;
	principal_type: 'user' | 'group' | string;
	role: 'viewer' | 'publisher' | 'admin' | string;
}

interface PermissionResponse {
	// Shape depends on your API; widen as needed
	success?: boolean;
	[key: string]: unknown;
}

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

	async getUserId(username: string): Promise<string | undefined> {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), 10_000);

		try {
			const res = await fetch(`${apiServer}users`, {
				method: 'GET',
				headers: this.headers,
				redirect: 'error', // mirrors --max-redirs 0 + --fail behavior
				signal: controller.signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`GET /users failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
			}

			const data = (await res.json()) as UsersResponse;

			const user1 = data.results.find(u => u.username === username);
			return user1?.guid; // undefined if not found
		} finally {
			clearTimeout(t);
		}
	}

	async setPythonVersion(version: string) {
		const editorContainer = this.code.driver.page.locator('[id="workbench.parts.editor"]');
		const dynamicTomlLineRegex = '[python]';
		const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });

		await expect(targetLine).toBeVisible({ timeout: 10000 });

		await targetLine.click();
		await this.code.driver.page.keyboard.press('End');
		await this.code.driver.page.keyboard.press('Enter');

		await this.code.driver.page.keyboard.type(`version = '${version}'`, { delay: 50 });
	}


	async setContentPermission(
		contentGuid: string,
		payload: PermissionPayload,
	): Promise<PermissionResponse> {
		const url = `${apiServer}content/${contentGuid}/permissions`;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);

		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify(payload),
				redirect: 'follow',
				signal: controller.signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
			}
			// If the API returns JSON, parse it; otherwise return empty object
			const contentType = res.headers.get('content-type') || '';
			return contentType.includes('application/json')
				? ((await res.json()) as PermissionResponse)
				: {};
		} finally {
			clearTimeout(timeout);
		}
	}
}
