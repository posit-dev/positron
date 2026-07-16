/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Code } from '../infra/code.js';

/**
 * A callback that runs a shell command and returns its captured output. Matches
 * the `runDockerCommand` test fixture so the resolver can reach the Workbench
 * `test` container without this page object depending on the fixture module.
 */
export type DockerRunner = (command: string, description: string) => Promise<{ stdout: string; stderr: string }>;

/**
 * Default local path (relative to the repo root / Playwright CWD) where the
 * connect-local one-shot bootstrap container writes the Connect API token.
 */
const LOCAL_TOKEN_FILE = path.resolve(process.cwd(), 'docker/environments/connect-local/.tokens/connect_bootstrap_token');

/**
 * Local marker recording the last-seen API key, used to detect a connect-data
 * volume wipe + re-bootstrap (the key changes) so a stale saved publisher
 * credential can be self-healed. Local-only.
 */
const KEY_MARKER_FILE = path.resolve(process.cwd(), 'docker/environments/connect-local/.tokens/.last_publisher_key');

/**
 * Local file where `with-connect.sh start` records the ephemeral Connect
 * container id, used by the local run to target `docker exec` (with-connect
 * gives the container a random name, unlike the Workbench `connect` container).
 */
const LOCAL_CONTAINER_ID_FILE = path.resolve(process.cwd(), 'docker/environments/connect-local/.tokens/.container_id');

const PING_URL = 'http://localhost:3939';

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

	/**
	 * Resolve the Connect publisher API token, trying (in order):
	 *   1. `CONNECT_PUBLISHER_API_KEY` env var
	 *   2. a local token file (`CONNECT_PUBLISHER_TOKEN_FILE` env var, else the
	 *      connect-local one-shot bootstrap output)
	 *   3. the Workbench `test` container's shared `/tokens` volume (via docker exec)
	 *
	 * The docker-exec fallback keeps the Workbench (`e2e-workbench`) run working
	 * unchanged; the first two branches are what the standalone `e2e-connect`
	 * local run exercises.
	 *
	 * @param dockerRunner optional runner used only for the docker-exec fallback.
	 */
	async resolveApiKey(dockerRunner?: DockerRunner): Promise<string> {
		// 1. Environment variable (e.g. exported by a CI workflow).
		const envKey = process.env.CONNECT_PUBLISHER_API_KEY?.trim();
		if (envKey) {
			return envKey;
		}

		// 2. Local token file written by the connect-local bootstrap container.
		const tokenFile = process.env.CONNECT_PUBLISHER_TOKEN_FILE?.trim() || LOCAL_TOKEN_FILE;
		try {
			const fileKey = fs.readFileSync(tokenFile, 'utf8').trim();
			if (fileKey) {
				return fileKey;
			}
		} catch {
			// File not present in this mode; fall through to the docker-exec branch.
		}

		// 3. Workbench shared volume (existing behavior, kept for the e2e-workbench run).
		if (dockerRunner) {
			const { stdout } = await dockerRunner(
				`docker exec test bash -lc 'set -euo pipefail; [ -s /tokens/connect_bootstrap_token ] && cat /tokens/connect_bootstrap_token'`,
				'Read Connect API key'
			);
			const dockerKey = stdout.trim();
			if (dockerKey) {
				return dockerKey;
			}
		}

		throw new Error(
			`Could not resolve a Connect publisher API key. Set CONNECT_PUBLISHER_API_KEY, ` +
			`provide a token file at ${tokenFile} (CONNECT_PUBLISHER_TOKEN_FILE to override), ` +
			`or ensure the Workbench 'test' container has /tokens/connect_bootstrap_token.`
		);
	}

	/**
	 * Resolve the ephemeral Connect container id for the local run, trying:
	 *   1. `CONNECT_CONTAINER_ID` env var (exported by the CI workflow from the
	 *      with-connect action output)
	 *   2. the local `.container_id` file written by `with-connect.sh start`
	 *
	 * Used to target `docker exec` for PAM user setup, since with-connect names
	 * the container randomly (the Workbench run uses the fixed `connect` name).
	 */
	resolveContainerId(): string {
		const envId = process.env.CONNECT_CONTAINER_ID?.trim();
		if (envId) {
			return envId;
		}
		try {
			const fileId = fs.readFileSync(LOCAL_CONTAINER_ID_FILE, 'utf8').trim();
			if (fileId) {
				return fileId;
			}
		} catch {
			// Fall through to the error below.
		}
		throw new Error(
			`Could not resolve the Connect container id. Set CONNECT_CONTAINER_ID, ` +
			`or run 'npm run connect:start' to write ${LOCAL_CONTAINER_ID_FILE}.`
		);
	}

	/**
	 * Whether the Connect server is reachable at all (unauthenticated). Used to
	 * skip the local suite gracefully when connect has not been started.
	 */
	async isReachable(): Promise<boolean> {
		// Mirror ensure-connect-token.sh: accept either the ping endpoint or the
		// root responding, so a missing /__ping__ doesn't spuriously skip.
		for (const url of [`${PING_URL}/__ping__`, PING_URL]) {
			const controller = new AbortController();
			const t = setTimeout(() => controller.abort(), 5_000);
			try {
				const res = await fetch(url, { signal: controller.signal });
				if (res.ok) {
					return true;
				}
			} catch {
				// Try the next URL.
			} finally {
				clearTimeout(t);
			}
		}
		return false;
	}

	/**
	 * Record the resolved API key and report whether it changed since the last
	 * local run. A change means the connect-data volume was wiped and
	 * re-bootstrapped, so any saved publisher credential now holds a stale key.
	 * The first-ever run returns `false` (nothing to heal). Best-effort: any I/O
	 * failure is treated as "no rotation". Local-only concern (marker lives under
	 * the connect-local token dir).
	 */
	recordKeyAndDetectRotation(key: string): boolean {
		let previous: string | undefined;
		try {
			previous = fs.readFileSync(KEY_MARKER_FILE, 'utf8').trim();
		} catch {
			// No prior marker; treat as first run.
		}
		try {
			fs.mkdirSync(path.dirname(KEY_MARKER_FILE), { recursive: true });
			fs.writeFileSync(KEY_MARKER_FILE, key, 'utf8');
		} catch {
			// Best-effort; a write failure just disables self-heal detection.
		}
		return previous !== undefined && previous !== key;
	}

	/**
	 * Whether the currently-set API key authenticates against the Connect API.
	 * A `false` return after a volume wipe means the stored key is stale.
	 */
	async isApiKeyValid(): Promise<boolean> {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), 10_000);
		try {
			const res = await fetch(`${apiServer}users?page_size=1`, {
				headers: this.headers,
				signal: controller.signal,
			});
			return res.ok;
		} catch {
			return false;
		} finally {
			clearTimeout(t);
		}
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

	/**
	 * Returns the username of the user the current API key authenticates as. Used to locate that
	 * user's owner node in the Data Connections pins tree (pins are grouped by owner username).
	 */
	async getCurrentUsername(): Promise<string> {
		const res = await fetch(`${apiServer}user`, { headers: this.headers });
		if (!res.ok) {
			throw new Error(`GET /user failed: ${res.status} ${res.statusText}`);
		}
		const data = (await res.json()) as { username?: string };
		if (!data.username) {
			throw new Error('Connect /v1/user did not return a username');
		}
		return data.username;
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
		const editorContainer = this.code.driver.currentPage.locator('[id="workbench.parts.editor"]');
		const dynamicTomlLineRegex = '[python]';
		const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });

		await expect(targetLine).toBeVisible({ timeout: 10000 });

		await targetLine.click();
		await this.code.driver.currentPage.keyboard.press('End');
		await this.code.driver.currentPage.keyboard.press('Enter');

		await this.code.driver.currentPage.keyboard.type(`version = '${version}'`, { delay: 50 });
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
				// 409 Conflict means the permission already exists, which is acceptable
				// since we're making this operation idempotent
				if (res.status === 409) {
					return { success: true, alreadyExists: true };
				}
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
