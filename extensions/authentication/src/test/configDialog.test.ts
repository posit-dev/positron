/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { authProviders, registerAuthProvider, showConfigurationDialog } from '../configDialog';
import { AuthProvider } from '../authProvider';
import { validateAnthropicApiKey } from '../validation';

suite('configDialog', () => {
	let originalShowLanguageModelConfig: typeof positron.ai.showLanguageModelConfig;
	let originalFetch: typeof globalThis.fetch;
	let provider: AuthProvider;

	setup(() => {
		authProviders.clear();
		originalShowLanguageModelConfig = positron.ai.showLanguageModelConfig;
		originalFetch = globalThis.fetch;
		const secrets = new Map<string, string>();
		const globalState = new Map<string, unknown>();
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
		provider = new AuthProvider('anthropic-api', 'Anthropic', mockContext);
		registerAuthProvider('anthropic-api', provider, {
			validateApiKey: async (apiKey) => validateAnthropicApiKey(apiKey),
		});
	});

	teardown(() => {
		provider.dispose();
		authProviders.clear();
		positron.ai.showLanguageModelConfig = originalShowLanguageModelConfig;
		globalThis.fetch = originalFetch;
	});

	test('validates Anthropic key before storing', async () => {
		let validated = false;
		let stored = false;
		globalThis.fetch = async () => {
			validated = true;
			return { ok: true, status: 200 } as Response;
		};

		provider.storeKey = async (accountId: string, label: string, key: string) => {
			stored = true;
			return {
				id: accountId,
				accessToken: key,
				account: { id: accountId, label },
				scopes: [],
			};
		};

		const source = {
			type: positron.PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic-api' },
			signedIn: false,
			defaults: { name: 'Anthropic', model: 'claude-sonnet-4-0' },
			supportedOptions: [],
		} as unknown as positron.ai.LanguageModelSource;

		positron.ai.showLanguageModelConfig = async (_sources, onAction) => {
			await onAction({ provider: 'anthropic-api', type: positron.PositronLanguageModelType.Chat, name: 'Anthropic', model: 'claude-sonnet-4-0', apiKey: 'sk-ant-valid' }, 'save');
		};

		await showConfigurationDialog([source]);

		assert.strictEqual(validated, true);
		assert.strictEqual(stored, true);
	});

	test('rejects invalid Anthropic key and does not store', async () => {
		let stored = false;
		globalThis.fetch = async () => {
			return { ok: false, status: 401 } as Response;
		};

		provider.storeKey = async (accountId: string, label: string, key: string) => {
			stored = true;
			return {
				id: accountId,
				accessToken: key,
				account: { id: accountId, label },
				scopes: [],
			};
		};

		const source = {
			type: positron.PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic-api' },
			signedIn: false,
			defaults: { name: 'Anthropic', model: 'claude-sonnet-4-0' },
			supportedOptions: [],
		} as unknown as positron.ai.LanguageModelSource;

		positron.ai.showLanguageModelConfig = async (_sources, onAction) => {
			await onAction({ provider: 'anthropic-api', type: positron.PositronLanguageModelType.Chat, name: 'Anthropic', model: 'claude-sonnet-4-0', apiKey: 'sk-ant-invalid' }, 'save');
		};

		await assert.rejects(
			showConfigurationDialog([source]),
			(error: Error) => error.message.includes('Invalid Anthropic API key')
		);
		assert.strictEqual(stored, false);
	});
});
