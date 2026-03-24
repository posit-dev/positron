/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ApiKeyAuthenticationProvider } from '../apiKeyProvider';

suite('ApiKeyAuthenticationProvider', () => {
	let provider: ApiKeyAuthenticationProvider;
	let secrets: Map<string, string>;
	let globalState: Map<string, unknown>;

	setup(() => {
		secrets = new Map();
		globalState = new Map();

		const mockContext = {
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

		provider = new ApiKeyAuthenticationProvider(
			'test-provider',
			'Test Provider',
			mockContext,
		);
	});

	teardown(() => {
		provider.dispose();
	});

	test('storeKey fires onDidChangeSessions with added session', async () => {
		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = provider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await provider.storeKey('acc-1', 'Test Account', 'sk-test-key');
		const event = await eventPromise;

		assert.strictEqual(event.added!.length, 1);
		assert.strictEqual(event.added![0].id, 'acc-1');
		assert.strictEqual(event.added![0].accessToken, 'sk-test-key');
		assert.strictEqual(event.removed!.length, 0);
	});

	test('removeSession fires onDidChangeSessions with removed session', async () => {
		// First store a session
		await provider.storeKey('acc-1', 'Test Account', 'sk-test-key');

		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = provider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await provider.removeSession('acc-1');
		const event = await eventPromise;

		assert.strictEqual(event.removed!.length, 1);
		assert.strictEqual(event.removed![0].id, 'acc-1');
		assert.strictEqual(event.added!.length, 0);
	});

	test('removeSession for nonexistent id does not fire event', async () => {
		let eventFired = false;
		const disposable = provider.onDidChangeSessions(() => {
			eventFired = true;
		});

		await provider.removeSession('nonexistent-id');

		// Give any async events a chance to fire
		await new Promise(resolve => setTimeout(resolve, 50));

		assert.strictEqual(eventFired, false);
		disposable.dispose();
	});

	test('getSessions returns stored sessions', async () => {
		await provider.storeKey('acc-1', 'Account 1', 'key-1');
		await provider.storeKey('acc-2', 'Account 2', 'key-2');

		const sessions = await provider.getSessions();

		assert.strictEqual(sessions.length, 2);
		const ids = sessions.map(s => s.id).sort();
		assert.deepStrictEqual(ids, ['acc-1', 'acc-2']);
		assert.strictEqual(
			sessions.find(s => s.id === 'acc-1')!.accessToken,
			'key-1'
		);
	});
});
