/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { DatabricksAuthProvider } from '../databricksAuthProvider';

const HOST = 'https://example.cloud.databricks.com';

function storeOAuthSecrets(secrets: Map<string, string>, overrides?: {
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	host?: string;
}): void {
	secrets.set('databricks.access_token', overrides?.accessToken ?? 'test-access-token');
	secrets.set('databricks.refresh_token', overrides?.refreshToken ?? 'test-refresh-token');
	secrets.set('databricks.token_expiry', String(overrides?.expiresAt ?? Date.now() + 3600 * 1000));
	secrets.set('databricks.host', overrides?.host ?? HOST);
}

function makeMockContext(): { context: vscode.ExtensionContext; secrets: Map<string, string> } {
	const secrets = new Map<string, string>();
	const globalState = new Map<string, unknown>();
	const context = {
		secrets: {
			get: (key: string) => Promise.resolve(secrets.get(key)),
			store: (key: string, value: string) => {
				secrets.set(key, value);
				return Promise.resolve();
			},
			delete: (key: string) => {
				secrets.delete(key);
				return Promise.resolve();
			},
		},
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: (key: string, value: unknown) => {
				globalState.set(key, value);
				return Promise.resolve();
			},
		},
	} as unknown as vscode.ExtensionContext;
	return { context, secrets };
}

suite('DatabricksAuthProvider', () => {
	let provider: DatabricksAuthProvider;
	let secrets: Map<string, string>;
	let originalFetch: typeof globalThis.fetch;

	setup(() => {
		originalFetch = globalThis.fetch;
		const mock = makeMockContext();
		secrets = mock.secrets;
		provider = new DatabricksAuthProvider(mock.context);
	});

	teardown(() => {
		provider.dispose();
		globalThis.fetch = originalFetch;
	});

	suite('getSessions', () => {
		test('returns the OAuth session when the token is fresh', async () => {
			storeOAuthSecrets(secrets, {
				accessToken: 'fresh-token',
				expiresAt: Date.now() + 30 * 60 * 1000,
			});

			const sessions = await provider.getSessions();
			assert.strictEqual(sessions.length, 1);
			assert.strictEqual(sessions[0].id, 'databricks');
			assert.strictEqual(sessions[0].accessToken, 'fresh-token');
			assert.strictEqual(
				sessions[0].account.label,
				'Databricks (example.cloud.databricks.com)'
			);
		});

		test('returns no sessions when nothing is stored', async () => {
			const sessions = await provider.getSessions();
			assert.deepStrictEqual(sessions, []);
		});

		test('refreshes a stale token and stores the result', async () => {
			storeOAuthSecrets(secrets, {
				accessToken: 'stale-token',
				expiresAt: Date.now() + 60 * 1000, // within the 5 min buffer
			});

			globalThis.fetch = async () => new Response(JSON.stringify({
				access_token: 'new-token',
				refresh_token: 'new-refresh',
				expires_in: 3600,
			}), { status: 200 });

			const sessions = await provider.getSessions();
			assert.strictEqual(sessions.length, 1);
			assert.strictEqual(sessions[0].accessToken, 'new-token');
			assert.strictEqual(secrets.get('databricks.access_token'), 'new-token');
			assert.strictEqual(secrets.get('databricks.refresh_token'), 'new-refresh');
			assert.strictEqual(secrets.get('databricks.host'), HOST);
		});

		test('clears secrets and fires removed when refresh fails', async () => {
			storeOAuthSecrets(secrets, { expiresAt: Date.now() - 1000 });

			globalThis.fetch = async () => new Response(JSON.stringify({
				error: 'invalid_grant',
				error_description: 'Refresh token revoked',
			}), { status: 401 });

			const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
			const subscription = provider.onDidChangeSessions(e => events.push(e));
			try {
				const sessions = await provider.getSessions();
				assert.deepStrictEqual(sessions, []);
			} finally {
				subscription.dispose();
			}

			assert.strictEqual(secrets.get('databricks.access_token'), undefined);
			assert.strictEqual(secrets.get('databricks.refresh_token'), undefined);
			assert.strictEqual(secrets.get('databricks.token_expiry'), undefined);
			assert.strictEqual(secrets.get('databricks.host'), undefined);

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].removed?.length, 1);
			assert.strictEqual(events[0].removed?.[0].id, 'databricks');
		});

		test('concurrent calls share a single refresh', async () => {
			storeOAuthSecrets(secrets, { expiresAt: Date.now() - 1000 });

			let fetchCount = 0;
			globalThis.fetch = async () => {
				fetchCount++;
				// Yield so both getSessions calls overlap the refresh.
				await new Promise(resolve => setTimeout(resolve, 20));
				return new Response(JSON.stringify({
					access_token: 'new-token',
					refresh_token: 'new-refresh',
					expires_in: 3600,
				}), { status: 200 });
			};

			const [a, b] = await Promise.all([
				provider.getSessions(),
				provider.getSessions(),
			]);

			assert.strictEqual(fetchCount, 1);
			assert.strictEqual(a[0].accessToken, 'new-token');
			assert.strictEqual(b[0].accessToken, 'new-token');
		});

		test('falls through to stored PAT sessions', async () => {
			await provider.storeKey('pat-account', 'Databricks (PAT)', 'dapi123');

			const sessions = await provider.getSessions();
			assert.strictEqual(sessions.length, 1);
			assert.strictEqual(sessions[0].id, 'pat-account');
			assert.strictEqual(sessions[0].accessToken, 'dapi123');
		});

		test('returns both OAuth and PAT sessions', async () => {
			storeOAuthSecrets(secrets, {
				expiresAt: Date.now() + 30 * 60 * 1000,
			});
			await provider.storeKey('pat-account', 'Databricks (PAT)', 'dapi123');

			const sessions = await provider.getSessions();
			assert.strictEqual(sessions.length, 2);
			assert.strictEqual(sessions[0].id, 'databricks');
			assert.strictEqual(sessions[1].id, 'pat-account');
		});
	});

	suite('removeSession', () => {
		test('clears OAuth secrets and fires removed for the OAuth session', async () => {
			storeOAuthSecrets(secrets);

			const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
			const subscription = provider.onDidChangeSessions(e => events.push(e));
			try {
				await provider.removeSession('databricks');
			} finally {
				subscription.dispose();
			}

			assert.strictEqual(secrets.get('databricks.access_token'), undefined);
			assert.strictEqual(secrets.get('databricks.refresh_token'), undefined);
			assert.strictEqual(secrets.get('databricks.token_expiry'), undefined);
			assert.strictEqual(secrets.get('databricks.host'), undefined);
			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].removed?.[0].id, 'databricks');
		});

		test('delegates PAT sessions to the base class', async () => {
			await provider.storeKey('pat-account', 'Databricks (PAT)', 'dapi123');

			await provider.removeSession('pat-account');

			const sessions = await provider.getSessions();
			assert.deepStrictEqual(sessions, []);
		});
	});
});
