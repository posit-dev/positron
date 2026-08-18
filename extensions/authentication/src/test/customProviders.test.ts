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
	createCustomProvider,
	deleteCustomProvider,
	getCachedCustomProviders,
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	readCustomProviderEntry,
	updateCustomProviderConnection,
} from '../providerCatalog';
import { getCustomProviderSources, PROVIDER_METADATA } from '../providerSources';

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
		test('createCustomProvider writes providers.custom.<name> and the cache reflects it', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });

			await createCustomProvider(
				'My Gateway',
				{ type: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' },
				{ configPath }
			);

			assert.deepStrictEqual(readConfig(configPath).providers.custom, {
				'My Gateway': { type: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' },
			});
			const cached = getCachedProvider('My Gateway');
			assert.strictEqual(cached?.clientKind, 'openai-compatible');
			assert.strictEqual(cached?.connection.baseUrl, 'https://gateway.example.com/v1');
			assert.strictEqual(cached?.enabled, true, 'entries are enabled by the baseline');
		});

		test('createCustomProvider rejects built-in ids and reserved keys', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });

			for (const name of ['anthropic', 'custom', 'default', '__proto__']) {
				await assert.rejects(
					createCustomProvider(name, { type: 'openai-compatible' }, { configPath }),
					`"${name}" should be rejected as a custom provider name`
				);
			}
			assert.strictEqual(readConfig(configPath).providers.custom, undefined);
		});

		test('createCustomProvider rejects a name that is already taken', async () => {
			writeConfig(configPath, { custom: { Taken: { type: 'ollama' } } });
			await initProviderCatalog(context, { configPath });

			await assert.rejects(
				createCustomProvider('Taken', { type: 'openai-compatible' }, { configPath }),
				/already exists/
			);
			assert.strictEqual(readConfig(configPath).providers.custom.Taken.type, 'ollama');
		});

		test('updateCustomProviderConnection preserves fields the UI does not own', async () => {
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

			await updateCustomProviderConnection(
				'My Gateway',
				{ baseUrl: 'https://new.example.com/v1' },
				{ configPath }
			);

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

		test('updateCustomProviderConnection treats a blank value as "remove the authored key"', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://old.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			await updateCustomProviderConnection('My Gateway', { baseUrl: '' }, { configPath });

			assert.deepStrictEqual(readConfig(configPath).providers.custom['My Gateway'], {
				type: 'openai-compatible',
			});
		});

		test('updateCustomProviderConnection refuses an entry with no user-layer record', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });

			await assert.rejects(
				updateCustomProviderConnection('Not Mine', { baseUrl: 'https://x.example.com' }, { configPath }),
				/No custom provider named/
			);
		});

		test('deleteCustomProvider removes the entry and drops an emptied custom map', async () => {
			writeConfig(configPath, {
				custom: { First: { type: 'ollama' }, Second: { type: 'lmstudio' } },
			});
			await initProviderCatalog(context, { configPath });

			await deleteCustomProvider('First', { configPath });
			assert.deepStrictEqual(readConfig(configPath).providers.custom, { Second: { type: 'lmstudio' } });

			await deleteCustomProvider('Second', { configPath });
			assert.strictEqual(readConfig(configPath).providers.custom, undefined);
			assert.strictEqual(getCachedProvider('Second'), undefined);
		});

		test('deleteCustomProvider is a no-op for an entry that is already gone', async () => {
			writeConfig(configPath, { custom: { Kept: { type: 'ollama' } } });
			await initProviderCatalog(context, { configPath });

			await deleteCustomProvider('Never Existed', { configPath });

			assert.deepStrictEqual(readConfig(configPath).providers.custom, { Kept: { type: 'ollama' } });
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
		test('an added entry lands in addedIds, a removed one in removedIds', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });

			const [added] = await capturingChanges(() =>
				createCustomProvider('My Gateway', { type: 'ollama' }, { configPath })
			);
			assert.ok(added.addedIds.includes('My Gateway'), 'addedIds should include the new entry');
			assert.ok(
				added.changedConnectionIds.includes('My Gateway'),
				'an added id is a connection change too, which is what the credential chain keys off'
			);
			assert.deepStrictEqual(added.removedIds, []);

			const [removed] = await capturingChanges(() =>
				deleteCustomProvider('My Gateway', { configPath })
			);
			assert.deepStrictEqual(removed.removedIds, ['My Gateway']);
			assert.deepStrictEqual(removed.addedIds, []);
		});

		test('editing an entry reports a connection change and nothing else', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://one.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			const [change] = await capturingChanges(() =>
				updateCustomProviderConnection('My Gateway', { baseUrl: 'https://two.example.com/v1' }, { configPath })
			);

			assert.deepStrictEqual(change.changedConnectionIds, ['My Gateway']);
			assert.deepStrictEqual(change.addedIds, []);
			assert.deepStrictEqual(change.removedIds, []);
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

			assert.deepStrictEqual(getCustomProviderSources().map(s => s.provider.id), ['On']);
		});

		test('the entry name is the provider id, display name, and catalog id', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			const [source] = getCustomProviderSources();
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
				},
			});
			await initProviderCatalog(context, { configPath });

			const options = Object.fromEntries(
				getCustomProviderSources().map(s => [s.provider.id, s.supportedOptions])
			);
			assert.deepStrictEqual(options, {
				Gateway: ['apiKey', 'baseUrl', 'toolCalls'],
				Local: ['baseUrl', 'toolCalls'],
				Bedrock: ['toolCalls'],
				// Resolves a Google Cloud credential from the environment, so it
				// must not ask for an API key.
				Vertex: ['baseUrl', 'toolCalls'],
			});
		});

		test('a local entry reports its endpoint as the base URL', async () => {
			writeConfig(configPath, {
				custom: { Local: { type: 'ollama', endpoint: 'http://localhost:11434' } },
			});
			await initProviderCatalog(context, { configPath });

			assert.strictEqual(getCustomProviderSources()[0].defaults.baseUrl, 'http://localhost:11434');
		});
	});
});
