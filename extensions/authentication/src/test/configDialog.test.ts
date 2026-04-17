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
			validateApiKey: async (apiKey, config) => validateAnthropicApiKey(apiKey, config),
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

	test('delete rejects when only chain session exists', async () => {
		const chainProvider = new AuthProvider(
			'anthropic-api', 'Anthropic',
			{
				secrets: {
					get: () => Promise.resolve(undefined),
					store: () => Promise.resolve(),
					delete: () => Promise.resolve(),
				},
				globalState: {
					get: () => undefined,
					update: () => Promise.resolve(),
				},
			} as unknown as vscode.ExtensionContext,
			undefined,
			{
				resolve: async () => 'sk-ant-test-key',
				preventSignOut: true,
			}
		);
		authProviders.clear();
		registerAuthProvider('anthropic-api', chainProvider);
		await chainProvider.resolveChainCredentials();

		const source = {
			type: positron.PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic-api' },
			signedIn: true,
			defaults: { name: 'Anthropic', model: 'claude-sonnet-4-0' },
			supportedOptions: [],
		} as unknown as positron.ai.LanguageModelSource;

		positron.ai.showLanguageModelConfig = async (_sources, onAction) => {
			await onAction({ provider: 'anthropic-api', type: positron.PositronLanguageModelType.Chat, name: 'Anthropic', model: 'claude-sonnet-4-0' }, 'delete');
		};

		await assert.rejects(
			showConfigurationDialog([source]),
			(error: Error) => error.message.includes('environment variable')
		);

		// Chain session should still exist
		const sessions = await chainProvider.getSessions();
		assert.strictEqual(sessions.length, 1);
		chainProvider.dispose();
	});

	test('save without apiKey calls createSession for chain provider', async () => {
		const chainProvider = new AuthProvider(
			'test-chain', 'Test Chain',
			{
				secrets: {
					get: () => Promise.resolve(undefined),
					store: () => Promise.resolve(),
					delete: () => Promise.resolve(),
				},
				globalState: {
					get: () => undefined,
					update: () => Promise.resolve(),
				},
			} as unknown as vscode.ExtensionContext,
			undefined,
			{
				resolve: async () => JSON.stringify({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }),
			}
		);
		registerAuthProvider('test-chain', chainProvider);

		const source = {
			type: positron.PositronLanguageModelType.Chat,
			provider: { id: 'test-chain', displayName: 'Test Chain', settingName: 'test-chain' },
			signedIn: false,
			defaults: { name: 'Test Chain', model: 'test-model' },
			supportedOptions: [],
		} as unknown as positron.ai.LanguageModelSource;

		positron.ai.showLanguageModelConfig = async (_sources, onAction) => {
			await onAction({ provider: 'test-chain', type: positron.PositronLanguageModelType.Chat, name: 'Test Chain', model: 'test-model' }, 'save');
		};

		const results = await showConfigurationDialog([source]);

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].action, 'save');
		assert.strictEqual(results[0].accountId, 'test-chain');
		chainProvider.dispose();
	});

	test('save with blank apiKey validates endpoint and succeeds for Custom Provider', async () => {
		let validatedWithEmptyKey = false;
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
		const customProvider = new AuthProvider(
			'openai-compatible', 'Custom Provider', mockContext
		);
		registerAuthProvider('openai-compatible', customProvider, {
			validateApiKey: async (apiKey, _config) => {
				validatedWithEmptyKey = apiKey === '';
			},
		});

		const source = {
			type: positron.PositronLanguageModelType.Chat,
			provider: { id: 'openai-compatible', displayName: 'Custom Provider', settingName: 'openai-compatible' },
			signedIn: false,
			defaults: { name: 'Custom Provider', model: 'local-model', baseUrl: 'http://localhost:1234/v1' },
			supportedOptions: [],
		} as unknown as positron.ai.LanguageModelSource;

		positron.ai.showLanguageModelConfig = async (_sources, onAction) => {
			await onAction({
				provider: 'openai-compatible',
				type: positron.PositronLanguageModelType.Chat,
				name: 'Custom Provider',
				model: 'local-model',
				baseUrl: 'http://localhost:1234/v1',
				apiKey: '',
			}, 'save');
		};

		const results = await showConfigurationDialog([source]);

		assert.strictEqual(validatedWithEmptyKey, true, 'should validate even with empty key');
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].action, 'save');
		assert.ok(results[0].accountId, 'should have an accountId');

		// Verify a session was created with an empty access token
		const sessions = await customProvider.getSessions();
		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0].accessToken, '');

		customProvider.dispose();
	});

	test('save without apiKey but with baseUrl persists base URL before chain resolution', async () => {
		let savedBaseUrl: string | undefined;
		let baseUrlDuringResolve: string | undefined;
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
		const chainProvider = new AuthProvider(
			'openai-api', 'OpenAI', mockContext,
			undefined,
			{
				resolve: async () => {
					// Record that onSave ran before resolve by
					// checking whether savedBaseUrl is set.
					baseUrlDuringResolve = savedBaseUrl;
					return 'sk-from-env';
				},
			}
		);
		registerAuthProvider('openai-api', chainProvider, {
			onSave: async (config) => {
				savedBaseUrl = config.baseUrl;
			},
		});

		const source = {
			type: positron.PositronLanguageModelType.Chat,
			provider: { id: 'openai-api', displayName: 'OpenAI', settingName: 'openai-api' },
			signedIn: false,
			defaults: { name: 'OpenAI', model: 'gpt-4o' },
			supportedOptions: [],
		} as unknown as positron.ai.LanguageModelSource;

		positron.ai.showLanguageModelConfig = async (_sources, onAction) => {
			await onAction({
				provider: 'openai-api',
				type: positron.PositronLanguageModelType.Chat,
				name: 'OpenAI',
				model: 'gpt-4o',
				baseUrl: 'https://my-proxy.example.com/v1',
			}, 'save');
		};

		const results = await showConfigurationDialog([source]);

		assert.strictEqual(savedBaseUrl, 'https://my-proxy.example.com/v1',
			'onSave should have been called with the custom base URL');
		assert.strictEqual(baseUrlDuringResolve, 'https://my-proxy.example.com/v1',
			'base URL should be persisted before chain resolution');
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].action, 'save');

		chainProvider.dispose();
	});
});
