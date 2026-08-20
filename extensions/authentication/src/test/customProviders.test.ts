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
import { customAuthMethod, customCredentialChain } from '../customProviderAuth';
import { customProviderSource, getRegistrableCustomProviders, PROVIDER_METADATA } from '../providerSources';

/** The model sources Positron registers for the catalog's custom entries. */
function customSources() {
	return getRegistrableCustomProviders().map(customProviderSource);
}

/** Minimal ExtensionContext stub: only `subscriptions` is read by initProviderCatalog. */
function fakeContext(): vscode.ExtensionContext {
	return { subscriptions: [] } as unknown as vscode.ExtensionContext;
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

			await saveCustomProviderUrl('My Gateway', 'https://new.example.com/v1', 'baseUrl', { configPath });

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
				saveCustomProviderUrl('Not Mine', 'https://x.example.com', 'baseUrl', { configPath }),
				/No custom provider named/
			);
		});

		test('saveCustomProviderUrl can write a local entry\'s endpoint instead', async () => {
			writeConfig(configPath, {
				custom: { Local: { type: 'ollama', endpoint: 'http://localhost:11434' } },
			});
			await initProviderCatalog(context, { configPath });

			await saveCustomProviderUrl('Local', 'http://localhost:1234', 'endpoint', { configPath });

			assert.deepStrictEqual(readConfig(configPath).providers.custom.Local, {
				type: 'ollama',
				endpoint: 'http://localhost:1234',
			});
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
				saveCustomProviderUrl('My Gateway', 'https://two.example.com/v1', 'baseUrl', { configPath })
			);

			assert.deepStrictEqual(change.changedConnectionIds, ['My Gateway']);
			assert.deepStrictEqual(change.disabledIds, []);
		});
	});

	suite('credentials', () => {
		test('a kind that resolves from the environment gets a chain', () => {
			assert.deepStrictEqual(
				['openai-compatible', 'aws', 'google-vertex', 'ollama'].map(kind => {
					const method = customAuthMethod(kind);
					return [kind, method, !!(method && customCredentialChain('Entry', method))];
				}),
				[
					// A stored key, so nothing to resolve.
					['openai-compatible', 'apikey', false],
					['aws', 'aws-credentials', true],
					['google-vertex', 'google-cloud', true],
					// No credential at all.
					['ollama', 'local', false],
				]
			);
		});

		test('an unsupported kind has no auth method, so it is not registrable', async () => {
			writeConfig(configPath, {
				custom: { Bogus: { type: 'not-a-real-kind' }, Fine: { type: 'ollama' } },
			});
			await initProviderCatalog(context, { configPath });

			assert.strictEqual(customAuthMethod('not-a-real-kind'), undefined);
			assert.deepStrictEqual(customSources().map(s => s.provider.id), ['Fine']);
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
					On: { type: 'ollama' },
					Off: { type: 'ollama', enabled: false },
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

		test('supported options follow the client kind', async () => {
			writeConfig(configPath, {
				custom: {
					Gateway: { type: 'openai-compatible' },
					Local: { type: 'ollama' },
					Bedrock: { type: 'aws' },
					Vertex: { type: 'google-vertex' },
					Cortex: { type: 'snowflake' },
				},
			});
			await initProviderCatalog(context, { configPath });

			const options = Object.fromEntries(
				customSources().map(s => [s.provider.id, s.supportedOptions])
			);
			assert.deepStrictEqual(options, {
				Gateway: ['apiKey', 'baseUrl', 'toolCalls'],
				Local: ['baseUrl', 'toolCalls'],
				Bedrock: ['toolCalls'],
				// Resolves a Google Cloud credential from the environment, so it
				// must not ask for an API key.
				Vertex: ['baseUrl', 'toolCalls'],
				// Its Cortex URL comes from snowflake.host, so a single URL
				// field would write a key the runtime doesn't read.
				Cortex: ['apiKey', 'toolCalls'],
			});
		});

		test('a local entry reports its endpoint as the base URL', async () => {
			writeConfig(configPath, {
				custom: { Local: { type: 'ollama', endpoint: 'http://localhost:11434' } },
			});
			await initProviderCatalog(context, { configPath });

			assert.strictEqual(customSources()[0].defaults.baseUrl, 'http://localhost:11434');
		});
	});
});
