/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { SecretTokenCredentialStore } from '../tokenCredentialStore.js';

/** An in-memory SecretStorage for tests. */
function fakeSecrets(): vscode.SecretStorage {
	const map = new Map<string, string>();
	const secrets = {
		get: async (key: string) => map.get(key),
		store: async (key: string, value: string) => { map.set(key, value); },
		delete: async (key: string) => { map.delete(key); },
		onDidChange: () => ({ dispose() { } }),
	};
	// eslint-disable-next-line local/code-no-any-casts
	return secrets as any as vscode.SecretStorage;
}

suite('SecretTokenCredentialStore', () => {
	test('round-trips a credential and returns undefined when absent', async () => {
		const store = new SecretTokenCredentialStore(fakeSecrets());
		assert.strictEqual(await store.get('https://connect.example.com'), undefined);
		await store.set('https://connect.example.com', { token: 'T-1', privateKey: 'pk' });
		assert.deepStrictEqual(await store.get('https://connect.example.com'), { token: 'T-1', privateKey: 'pk' });
	});

	test('keys by normalized server URL, so a bare host and a trailing slash share an entry', async () => {
		const store = new SecretTokenCredentialStore(fakeSecrets());
		await store.set('connect.example.com/', { token: 'T-2', privateKey: 'pk2' });
		// A bare host normalizes to the same https URL, so the credential is found.
		assert.deepStrictEqual(await store.get('https://connect.example.com'), { token: 'T-2', privateKey: 'pk2' });
	});

	test('treats a malformed entry as absent', async () => {
		// Return malformed JSON for whatever key the store computes, so the test exercises the
		// parse-failure behavior without hard-coding (and coupling to) the secret key scheme.
		const raw = {
			get: async () => 'not json',
			store: async () => { },
			delete: async () => { },
			onDidChange: () => ({ dispose() { } }),
		};
		// eslint-disable-next-line local/code-no-any-casts
		const malformedSecrets = raw as any as vscode.SecretStorage;
		const store = new SecretTokenCredentialStore(malformedSecrets);
		assert.strictEqual(await store.get('https://connect.example.com'), undefined);
	});
});
