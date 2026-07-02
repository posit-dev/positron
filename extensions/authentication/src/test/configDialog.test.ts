/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { authProviders, registerAuthProvider, providerAction, updateProviderFromSessions } from '../configDialog';
import { AuthProvider } from '../authProvider';
import { validateAnthropicApiKey } from '../validation';

suite('configDialog', () => {
	let originalGetEnabledProviders: typeof positron.ai.getEnabledProviders;
	let originalUpdateProvider: typeof positron.ai.updateProvider;
	let originalFetch: typeof globalThis.fetch;
	let provider: AuthProvider;
	let updateCalls: Array<{ id: string; update: Partial<positron.ai.LanguageModelSource> }>;

	setup(() => {
		authProviders.clear();
		originalGetEnabledProviders = positron.ai.getEnabledProviders;
		originalUpdateProvider = positron.ai.updateProvider;
		originalFetch = globalThis.fetch;

		// Mock getEnabledProviders to return all providers by default
		(positron.ai as any).getEnabledProviders = async () => [
			'anthropic-api', 'openai-api', 'openai-compatible', 'test-chain'
		];

		// Capture updateProvider calls for credential-state assertions
		updateCalls = [];
		(positron.ai as any).updateProvider = (id: string, update: Partial<positron.ai.LanguageModelSource>) => {
			updateCalls.push({ id, update });
		};

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
		(positron.ai as any).getEnabledProviders = originalGetEnabledProviders;
		(positron.ai as any).updateProvider = originalUpdateProvider;
		globalThis.fetch = originalFetch;
	});

	function makeSession(id: string): vscode.AuthenticationSession {
		return { id, accessToken: 'token', account: { id, label: 'Test' }, scopes: [] };
	}

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

		await providerAction(
			{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' }, supportedOptions: [], defaults: {} },
			{ model: 'claude-sonnet-4-0', apiKey: 'sk-ant-valid' },
			'save'
		);

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

		await assert.rejects(
			providerAction(
				{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' }, supportedOptions: [], defaults: {} },
				{ model: 'claude-sonnet-4-0', apiKey: 'sk-ant-invalid' },
				'save'
			),
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

		await assert.rejects(
			providerAction(
				{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' }, supportedOptions: [], defaults: {} },
				{ model: 'claude-sonnet-4-0' },
				'delete'
			),
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

		await providerAction(
			{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'test-chain', displayName: 'Test Chain', settingName: 'testChain' }, supportedOptions: [], defaults: {} },
			{ model: 'test-model' },
			'save'
		);

		const sessions = await chainProvider.getSessions();
		assert.strictEqual(sessions.length, 1);
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

		await providerAction(
			{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'openai-compatible', displayName: 'Custom Provider', settingName: 'customProvider' }, supportedOptions: [], defaults: {} },
			{ model: 'local-model', baseUrl: 'http://localhost:1234/v1', apiKey: '' },
			'save'
		);

		assert.strictEqual(validatedWithEmptyKey, true, 'should validate even with empty key');

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

		await providerAction(
			{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'openai-api', displayName: 'OpenAI', settingName: 'openAI' }, supportedOptions: [], defaults: {} },
			{ model: 'gpt-4o', baseUrl: 'https://my-proxy.example.com/v1' },
			'save'
		);

		assert.strictEqual(savedBaseUrl, 'https://my-proxy.example.com/v1',
			'onSave should have been called with the custom base URL');
		assert.strictEqual(baseUrlDuringResolve, 'https://my-proxy.example.com/v1',
			'base URL should be persisted before chain resolution');

		chainProvider.dispose();
	});

	test('copilot sign-in shows no success message when no session results', async () => {
		const originalGetSession = vscode.authentication.getSession;
		const originalShowInfo = vscode.window.showInformationMessage;
		let infoShown = false;
		// Simulate the user cancelling GitHub sign-in: no session is created.
		(vscode.authentication as any).getSession = async () => undefined;
		(vscode.window as any).showInformationMessage = () => {
			infoShown = true;
			return Promise.resolve(undefined);
		};
		try {
			await providerAction(
				{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'copilot-auth', displayName: 'GitHub Copilot', settingName: 'githubCopilot' }, supportedOptions: [], defaults: {} },
				{},
				'oauth-signin'
			);
			assert.strictEqual(infoShown, false);
		} finally {
			(vscode.authentication as any).getSession = originalGetSession;
			(vscode.window as any).showInformationMessage = originalShowInfo;
		}
	});

	suite('credential state updates', () => {
		// A chain provider records its configured state (via isConfigured) once
		// it has successfully resolved, independent of current session validity.
		function registerChainProvider(providerId: string): AuthProvider {
			const globalState = new Map<string, unknown>();
			const chainProvider = new AuthProvider(
				providerId, providerId,
				{
					secrets: {
						get: () => Promise.resolve(undefined),
						store: () => Promise.resolve(),
						delete: () => Promise.resolve(),
					},
					globalState: {
						get: <T>(key: string) => globalState.get(key) as T | undefined,
						update: (key: string, value: unknown) => {
							globalState.set(key, value);
							return Promise.resolve();
						},
					},
				} as unknown as vscode.ExtensionContext,
				undefined,
				{ resolve: async () => 'chain-token' }
			);
			registerAuthProvider(providerId, chainProvider);
			return chainProvider;
		}

		test('sessions present reports ok; later empty list reports expired', async () => {
			const chainProvider = registerChainProvider('amazon-bedrock');
			// Resolving the chain persists the provider's configured state.
			await chainProvider.resolveChainCredentials();

			// Chain sessions use the provider ID as the session ID.
			await updateProviderFromSessions('amazon-bedrock', [makeSession('amazon-bedrock')]);
			// Sessions later disappear (e.g. expired chain after a reload): the
			// provider's persisted configured state turns the empty list into an
			// expired session.
			await updateProviderFromSessions('amazon-bedrock', []);

			chainProvider.dispose();

			assert.deepStrictEqual(updateCalls, [
				{ id: 'amazon-bedrock', update: { signedIn: true, status: 'ok', statusMessage: undefined } },
				{ id: 'amazon-bedrock', update: { signedIn: false, status: 'error', statusMessage: 'Authentication expired' } },
			]);
		});

		test('no sessions and no prior sign-in reports null status', async () => {
			await updateProviderFromSessions('anthropic-api', []);

			assert.deepStrictEqual(updateCalls, [
				{ id: 'anthropic-api', update: { signedIn: false, status: null, statusMessage: undefined } },
			]);
		});

		test('delete clears the configured state', async () => {
			await provider.storeKey('uuid-1', 'Anthropic', 'sk-ant-key');
			await updateProviderFromSessions('anthropic-api', await provider.getSessions());

			await providerAction(
				{ type: positron.PositronLanguageModelType.Chat, provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' }, supportedOptions: [], defaults: {} },
				{},
				'delete'
			);
			await updateProviderFromSessions('anthropic-api', await provider.getSessions());

			assert.deepStrictEqual(updateCalls.at(-1), {
				id: 'anthropic-api',
				update: { signedIn: false, status: null, statusMessage: undefined },
			});
		});

		test('copilot-auth signed in marks autoconfigure signed in', async () => {
			await updateProviderFromSessions('copilot-auth', [makeSession('gh-uuid')]);

			assert.deepStrictEqual(updateCalls.at(-1), {
				id: 'copilot-auth',
				update: {
					signedIn: true,
					status: 'ok',
					statusMessage: undefined,
					defaults: {
						autoconfigure: {
							type: positron.ai.LanguageModelAutoconfigureType.Custom,
							message: 'the Accounts menu.',
							signedIn: true,
						},
					},
				},
			});
		});

		test('copilot-auth never reports an expired session', async () => {
			await updateProviderFromSessions('copilot-auth', [makeSession('gh-uuid')]);
			await updateProviderFromSessions('copilot-auth', []);

			assert.deepStrictEqual(updateCalls.at(-1), {
				id: 'copilot-auth',
				update: {
					signedIn: false,
					status: null,
					statusMessage: undefined,
					defaults: {
						autoconfigure: {
							type: positron.ai.LanguageModelAutoconfigureType.Custom,
							message: 'the Accounts menu.',
							signedIn: false,
						},
					},
				},
			});
		});
	});
});
