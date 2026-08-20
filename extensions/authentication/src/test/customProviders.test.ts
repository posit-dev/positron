/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getCachedCustomProviders,
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	readCustomProviderEntry,
	refreshProviderCatalog,
	saveCustomProviderUrl,
} from '../providerCatalog';
import {
	customApiKeyValidator,
	customAuthDescriptor,
	isOfferedCustomKind,
} from '../customProviderAuth';
import { CustomProviderRegistry } from '../customProviderRegistry';
import { customProviderSource, getRegistrableCustomProviders, PROVIDER_METADATA } from '../providerSources';

/** The model sources Positron registers for the catalog's custom entries. */
function customSources() {
	return getRegistrableCustomProviders().map(customProviderSource);
}

/** Minimal ExtensionContext stub: only `subscriptions` is read by initProviderCatalog. */
function fakeContext(): vscode.ExtensionContext {
	return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** As above, plus the in-memory storage an AuthProvider reads. */
function storageContext(): vscode.ExtensionContext {
	const secrets = new Map<string, string>();
	const globalState = new Map<string, unknown>();
	return {
		subscriptions: [],
		secrets: {
			get: (key: string) => Promise.resolve(secrets.get(key)),
			store: (key: string, value: string) => { secrets.set(key, value); return Promise.resolve(); },
			delete: (key: string) => { secrets.delete(key); return Promise.resolve(); },
		},
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: (key: string, value: unknown) => { globalState.set(key, value); return Promise.resolve(); },
		},
	} as unknown as vscode.ExtensionContext;
}

/** Poll until `condition` holds, so a main-thread round trip can land. */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 25));
	}
}

type CatalogChange = Parameters<Parameters<typeof onDidChangeProviderCatalog>[0]>[0];

/** A complete custom model definition; the schema requires every support flag. */
const customModel = {
	id: 'm1',
	name: 'M1',
	maxContextLength: 1000,
	supportsTools: true,
	supportsImages: false,
	supportsToolResultImages: false,
	supportsWebSearch: false,
};

function writeConfig(configPath: string, providers: Record<string, unknown>): void {
	fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers }));
}

function readConfig(configPath: string): { providers: Record<string, any> } {
	return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/** Collects change events fired while `run` is in flight. */
async function capturingChanges(run: () => Promise<void>): Promise<CatalogChange[]> {
	const payloads: CatalogChange[] = [];
	const sub = onDidChangeProviderCatalog(p => payloads.push(p));
	try {
		await run();
	} finally {
		sub.dispose();
	}
	return payloads;
}

suite('custom providers', () => {
	let dir: string;
	let configPath: string;
	let context: vscode.ExtensionContext;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-providers-'));
		configPath = path.join(dir, 'providers.json');
		context = fakeContext();
	});

	teardown(() => {
		for (const d of context.subscriptions) {
			d.dispose();
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	suite('write path', () => {
		test('saveCustomProviderUrl preserves fields the UI does not own', async () => {
			writeConfig(configPath, {
				custom: {
					'My Gateway': {
						type: 'openai-compatible',
						baseUrl: 'https://old.example.com/v1',
						protocol: 'openai-chat',
						customHeaders: { 'X-Tenant': 'acme' },
						endpoints: { 'openai-chat': 'https://old.example.com/chat' },
						models: { discovery: 'off', custom: [customModel] },
						enabled: true,
					},
				},
			});
			await initProviderCatalog(context, { configPath });

			await saveCustomProviderUrl('My Gateway', 'https://new.example.com/v1', { configPath });

			assert.deepStrictEqual(readConfig(configPath).providers.custom['My Gateway'], {
				type: 'openai-compatible',
				baseUrl: 'https://new.example.com/v1',
				protocol: 'openai-chat',
				customHeaders: { 'X-Tenant': 'acme' },
				endpoints: { 'openai-chat': 'https://old.example.com/chat' },
				models: { discovery: 'off', custom: [customModel] },
				enabled: true,
			});
		});

		test('saveCustomProviderUrl refuses an entry with no user-layer record', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });

			await assert.rejects(
				saveCustomProviderUrl('Not Mine', 'https://x.example.com', { configPath }),
				/No custom provider named/
			);
		});

		test('readCustomProviderEntry returns the entry as authored', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://authored.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			assert.deepStrictEqual(await readCustomProviderEntry('My Gateway', { configPath }), {
				type: 'openai-compatible',
				baseUrl: 'https://authored.example.com/v1',
			});
			assert.strictEqual(await readCustomProviderEntry('Absent', { configPath }), undefined);
		});
	});

	suite('catalog change events', () => {
		test('an entry disappearing fires a change, so listeners can drop it', async () => {
			writeConfig(configPath, { custom: { 'My Gateway': { type: 'ollama' } } });
			await initProviderCatalog(context, { configPath });

			writeConfig(configPath, {});
			const changes = await capturingChanges(() => refreshProviderCatalog({ configPath }));

			assert.strictEqual(changes.length, 1, 'a removal is a change even though no remaining entry moved');
			assert.strictEqual(getCachedProvider('My Gateway'), undefined);
		});

		test('editing an entry reports it as a connection change', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://one.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			const [change] = await capturingChanges(() =>
				saveCustomProviderUrl('My Gateway', 'https://two.example.com/v1', { configPath })
			);

			assert.deepStrictEqual(change.changedConnectionIds, ['My Gateway']);
			assert.deepStrictEqual(change.disabledIds, []);
		});
	});

	suite('keys', () => {
		test('an api key is optional for the kinds the authority says it is', () => {
			assert.deepStrictEqual(
				['openai-compatible', 'anthropic', 'openai']
					.map(kind => [kind, customAuthDescriptor(kind)?.apiKeyOptional]),
				[
					// A gateway can have auth switched off; refusing a blank key
					// would refuse a setup Posit Assistant accepts.
					['openai-compatible', true],
					['anthropic', false],
					['openai', false],
				]
			);
		});

		test('a key is checked by the kind\'s own validator, and only refused when the kind needs one', async () => {
			// An empty key on a kind that requires one is reported here rather
			// than at the first chat.
			await assert.rejects(
				customApiKeyValidator('anthropic')!('', {}),
				/An API key is required/
			);
			// A gateway with auth off accepts a blank key, but still has its
			// connection checked, which is where a missing base URL is caught.
			await assert.rejects(
				customApiKeyValidator('openai-compatible')!('', {}),
				/base URL is required/
			);

			assert.deepStrictEqual(
				['openai-compatible', 'anthropic', 'openai', 'ollama']
					.map(kind => [kind, !!customApiKeyValidator(kind)]),
				[
					['openai-compatible', true],
					['anthropic', true],
					['openai', true],
					// Not offered, so nothing registers it and nothing checks it.
					['ollama', false],
				]
			);
		});

		test('only the offered kinds are registrable', async () => {
			writeConfig(configPath, {
				custom: {
					Bogus: { type: 'not-a-real-kind' },
					Gateway: { type: 'openai-compatible' },
					Claude: { type: 'anthropic' },
					GPT: { type: 'openai' },
					// Supported by ai-config, not offered by Positron yet: each
					// needs connection fields the modal can't collect (#12747).
					Local: { type: 'ollama' },
					Bedrock: { type: 'aws' },
					Cortex: { type: 'snowflake' },
					Vertex: { type: 'google-vertex' },
				},
			});
			await initProviderCatalog(context, { configPath });

			assert.deepStrictEqual(
				customSources().map(s => s.provider.id),
				['Gateway', 'Claude', 'GPT']
			);
			assert.strictEqual(isOfferedCustomKind('not-a-real-kind'), false);
		});
	});

	suite('registration', () => {
		test('registering an entry fires a session change, which is how a stale "unregistered" verdict recovers', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			const fired: string[] = [];
			const subscription = vscode.authentication.onDidChangeSessions(e => fired.push(e.provider.id));
			// Registering the model source would reach the real workbench; the
			// auth registration inside register() is the part under test.
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } })
			);
			try {
				await registry.reconcile();
				await waitFor(() => fired.includes('My Gateway'));
			} finally {
				subscription.dispose();
				registry.dispose();
			}

			assert.ok(
				fired.includes('My Gateway'),
				'Posit Assistant only learns an entry registered from this event'
			);
		});
	});

	suite('sources', () => {
		test('getCachedCustomProviders returns custom entries only', async () => {
			writeConfig(configPath, {
				anthropic: { baseUrl: 'https://api.anthropic.com/v1' },
				custom: { 'My Gateway': { type: 'openai-compatible' } },
			});
			await initProviderCatalog(context, { configPath });

			assert.deepStrictEqual(getCachedCustomProviders().map(p => p.id), ['My Gateway']);
		});

		test('a disabled entry is left out of the sources', async () => {
			writeConfig(configPath, {
				custom: {
					On: { type: 'openai-compatible' },
					Off: { type: 'openai-compatible', enabled: false },
				},
			});
			await initProviderCatalog(context, { configPath });

			assert.deepStrictEqual(customSources().map(s => s.provider.id), ['On']);
		});

		test('the entry name is the provider id, display name, and catalog id', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			const [source] = customSources();
			assert.deepStrictEqual(source.provider, {
				id: 'My Gateway',
				displayName: 'My Gateway',
				status: 'experimental',
				catalogId: 'My Gateway',
			});
			assert.strictEqual(source.defaults.baseUrl, 'https://gateway.example.com/v1');
		});

		test('a kind collects what its built-in provider collects', async () => {
			writeConfig(configPath, {
				custom: {
					Gateway: { type: 'openai-compatible' },
					Claude: { type: 'anthropic' },
					GPT: { type: 'openai' },
				},
			});
			await initProviderCatalog(context, { configPath });

			const options = Object.fromEntries(
				customSources().map(s => [s.provider.id, s.supportedOptions])
			);
			// Each list is the matching built-in's own, minus what only the one
			// built-in instance can use (`autoconfigure`, `oauth`), the API type
			// field this work removes (`protocol`), and `customModels`, which
			// has no write path for a custom entry yet.
			assert.deepStrictEqual(options, {
				Gateway: ['apiKey', 'baseUrl', 'toolCalls'],
				// The built-in Anthropic tile asks for a key and a URL, and does
				// not offer a tool-calls switch. Neither does a custom one.
				Claude: ['apiKey', 'baseUrl'],
				GPT: ['apiKey', 'baseUrl', 'toolCalls'],
			});
		});

		test('an entry that carries an endpoint instead of a base URL reports it', async () => {
			writeConfig(configPath, {
				custom: { Gateway: { type: 'openai-compatible', endpoint: 'http://localhost:1234/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			assert.strictEqual(customSources()[0].defaults.baseUrl, 'http://localhost:1234/v1');
		});
	});
});
