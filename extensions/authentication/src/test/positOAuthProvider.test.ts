/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { POSIT_AUTH_PROVIDER_ID } from '../constants';
import { PositOAuthProvider } from '../positOAuthProvider';

function storeValidTokens(secrets: Map<string, string>, overrides?: {
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
}): void {
	secrets.set('posit-ai.access_token', overrides?.accessToken ?? 'test-access-token');
	secrets.set('posit-ai.refresh_token', overrides?.refreshToken ?? 'test-refresh-token');
	secrets.set('posit-ai.token_expiry', String(overrides?.expiresAt ?? Date.now() + 3600 * 1000));
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

suite('PositOAuthProvider', () => {
	let provider: PositOAuthProvider;
	let secrets: Map<string, string>;
	let originalFetch: typeof globalThis.fetch;

	setup(() => {
		originalFetch = globalThis.fetch;
		const mock = makeMockContext();
		secrets = mock.secrets;
		provider = new PositOAuthProvider(mock.context);
	});

	teardown(() => {
		provider.dispose();
		globalThis.fetch = originalFetch;
	});

	// --- getSessions ---

	suite('getSessions', () => {
		test('returns session when tokens exist', async () => {
			storeValidTokens(secrets);
			const sessions = await provider.getSessions();
			assert.strictEqual(sessions.length, 1);
			assert.strictEqual(sessions[0].id, POSIT_AUTH_PROVIDER_ID);
			assert.strictEqual(sessions[0].accessToken, 'test-access-token');
			assert.strictEqual(sessions[0].account.id, POSIT_AUTH_PROVIDER_ID);
		});

		test('returns empty when access token missing', async () => {
			secrets.set('posit-ai.token_expiry', String(Date.now() + 3600 * 1000));
			const sessions = await provider.getSessions();
			assert.strictEqual(sessions.length, 0);
		});

	});

	// --- removeSession ---

	suite('removeSession', () => {
		test('clears stored tokens', async () => {
			storeValidTokens(secrets);
			await provider.removeSession('');
			assert.strictEqual(secrets.has('posit-ai.access_token'), false);
			assert.strictEqual(secrets.has('posit-ai.refresh_token'), false);
			assert.strictEqual(secrets.has('posit-ai.token_expiry'), false);
		});

		test('fires onDidChangeSessions with removed session', async () => {
			storeValidTokens(secrets);

			const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
				resolve => {
					const disposable = provider.onDidChangeSessions(e => {
						disposable.dispose();
						resolve(e);
					});
				}
			);

			await provider.removeSession('');
			const event = await eventPromise;

			assert.strictEqual(event.removed!.length, 1);
			assert.strictEqual(event.removed![0].id, POSIT_AUTH_PROVIDER_ID);
			assert.strictEqual(event.added!.length, 0);
		});

	});

	// --- getAccessToken ---

	suite('getAccessToken', () => {
		test('returns token when not expired', async () => {
			storeValidTokens(secrets, {
				accessToken: 'fresh-token',
				expiresAt: Date.now() + 30 * 60 * 1000,
			});

			const token = await provider.getAccessToken();
			assert.strictEqual(token, 'fresh-token');
		});

		test('throws when no tokens stored', async () => {
			await assert.rejects(
				() => provider.getAccessToken(),
				(err: Error) => err.message.includes('No Posit AI access token found')
			);
		});

		test('refreshes when token is near expiry', async () => {
			storeValidTokens(secrets, {
				expiresAt: Date.now() + 5 * 60 * 1000, // 5 min (within 10 min buffer)
			});

			globalThis.fetch = async () => {
				return new Response(JSON.stringify({
					access_token: 'new-token',
					refresh_token: 'new-refresh',
					expires_in: 3600,
				}), { status: 200 });
			};

			const token = await provider.getAccessToken();
			assert.strictEqual(token, 'new-token');

			// Verify new tokens were stored
			assert.strictEqual(secrets.get('posit-ai.access_token'), 'new-token');
			assert.strictEqual(secrets.get('posit-ai.refresh_token'), 'new-refresh');
		});

		test('returns failure when refresh fails', async () => {
			storeValidTokens(secrets, { expiresAt: Date.now() - 1000 });

			globalThis.fetch = async () => {
				return new Response(
					JSON.stringify({ error_description: 'bad token' }),
					{ status: 401 }
				);
			};

			await assert.rejects(
				() => provider.getAccessToken(),
				(err: Error) => err.message.includes('Failed to refresh')
			);
		});
	});

});
