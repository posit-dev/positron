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
	createCustomProviderEntry,
	getCachedCustomProviders,
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	readCustomProviderEntry,
	refreshProviderCatalog,
	saveCustomProviderUrl,
} from '../providerCatalog';
import { authProviders, registerAuthProvider, unregisterAuthProvider } from '../configDialog';
import { ANTHROPIC_AUTH_PROVIDER_ID, POSITRON_CUSTOM_AUTH_PROVIDER_ID } from '../constants';
import { AuthProvider } from '../authProvider';
import { CustomProviderAggregate } from '../customProviderAggregate';
import {
	customApiKeyValidator,
	customAuthDescriptor,
	isOfferedCustomKind,
	reservedAuthProviderIdsForTest,
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

/**
 * Stands in for `vscode.authentication.registerAuthenticationProvider`. The
 * extension's activation already registered the shared custom-provider id, and
 * the extension host is first-one-wins, so a test registering it again would be
 * dropped and its dispose would unregister the real one.
 */
const noSharedRegistration = () => ({ dispose: () => { } });

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

	suite('create', () => {
		test('writes the entry with its declared models and leaves the neighbours alone', async () => {
			writeConfig(configPath, {
				anthropic: { baseUrl: 'https://api.anthropic.com/v1' },
				custom: { Existing: { type: 'anthropic' } },
			});
			await initProviderCatalog(context, { configPath });

			await createCustomProviderEntry(
				'My Gateway',
				'openai-compatible',
				{ baseUrl: 'https://gateway.example.com/v1', modelIds: ['llama-3.3-70b', '  '] },
				{ configPath }
			);

			assert.deepStrictEqual(readConfig(configPath).providers, {
				anthropic: { baseUrl: 'https://api.anthropic.com/v1' },
				custom: {
					Existing: { type: 'anthropic' },
					'My Gateway': {
						type: 'openai-compatible',
						enabled: true,
						baseUrl: 'https://gateway.example.com/v1',
						// Declared ids replace discovery: an endpoint with no
						// listing has nothing to discover.
						models: {
							discovery: 'off',
							custom: [{
								id: 'llama-3.3-70b',
								name: 'llama-3.3-70b',
								maxContextLength: 128000,
								supportsTools: true,
								supportsImages: false,
								supportsToolResultImages: false,
								supportsWebSearch: false,
							}],
						},
					},
				},
			});
		});

		test('refuses a name that is a built-in provider id, a reserved key, or already taken', async () => {
			writeConfig(configPath, { custom: { Taken: { type: 'anthropic' } } });
			await initProviderCatalog(context, { configPath });

			await assert.rejects(createCustomProviderEntry('anthropic', 'anthropic', {}, { configPath }));
			await assert.rejects(createCustomProviderEntry('custom', 'anthropic', {}, { configPath }));
			await assert.rejects(
				createCustomProviderEntry('Taken', 'anthropic', {}, { configPath }),
				/already exists/
			);
			assert.deepStrictEqual(Object.keys(readConfig(configPath).providers.custom), ['Taken']);
		});

		test('a key the provider refuses writes nothing at all', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } }),
				undefined,
				noSharedRegistration
			);

			try {
				// Anthropic requires a key, so a blank one is refused by the
				// same check the built-in Anthropic tile runs.
				await assert.rejects(
					registry.create({ name: 'Work Anthropic', kind: 'anthropic', apiKey: '' }),
					/An API key is required/
				);
			} finally {
				registry.dispose();
			}

			assert.strictEqual(readConfig(configPath).providers?.custom, undefined);
		});

		test('refuses a kind Positron cannot configure', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } }),
				undefined,
				noSharedRegistration
			);

			try {
				await assert.rejects(
					registry.create({ name: 'My Local', kind: 'ollama' }),
					/cannot configure/
				);
			} finally {
				registry.dispose();
			}
		});

		test('stores the credential under the entry name, which is the scope it is read by', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });
			// No live endpoint to check the key against, so the check is stubbed
			// out; what it does is covered by the validator tests above.
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } }),
				() => undefined,
				noSharedRegistration
			);

			try {
				await registry.create({
					name: 'My Gateway',
					kind: 'openai-compatible',
					baseUrl: 'https://gateway.example.com/v1',
					apiKey: 'sk-test',
				});
				const sessions = await authProviders.get('My Gateway')!.getSessions();
				assert.deepStrictEqual(sessions.map(s => s.accessToken), ['sk-test']);
			} finally {
				registry.dispose();
			}
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
				/Base URL is required/
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
		test('registering an entry fires a session change on the shared provider, which is how a stale "unregistered" verdict recovers', async () => {
			writeConfig(configPath, {
				custom: { 'My Gateway': { type: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' } },
			});
			await initProviderCatalog(context, { configPath });

			// Registering the model source would reach the real workbench, and
			// the extension's own activation already holds the shared auth
			// provider's id, so capture what would have been registered and
			// listen to it directly. Delivering the event to other extensions is
			// extHostAuthentication's job, not this registry's.
			let registeredId: string | undefined;
			let shared: vscode.AuthenticationProvider | undefined;
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } }),
				undefined,
				(id, _label, provider) => {
					registeredId = id;
					shared = provider;
					return { dispose: () => { } };
				}
			);
			const fired: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
			const subscription = shared!.onDidChangeSessions(e => fired.push(e));

			try {
				await registry.reconcile();
				await waitFor(() => fired.length > 0);
			} finally {
				subscription.dispose();
				registry.dispose();
			}

			assert.deepStrictEqual({
				// One static id for every entry, so it can be allowlisted in
				// product.json. The entry name is a scope now, not a provider id.
				registeredId,
				events: fired.length,
			}, {
				registeredId: POSITRON_CUSTOM_AUTH_PROVIDER_ID,
				events: 1,
			});
		});
	});


	suite('the shared auth provider', () => {
		/**
		 * One aggregate holding real `AuthProvider` delegates, each with a key
		 * already stored, so routing is exercised against the same code the
		 * modal drives rather than a stand-in.
		 */
		async function aggregateWith(
			entries: Record<string, string>
		): Promise<{ aggregate: CustomProviderAggregate; delegates: Map<string, AuthProvider> }> {
			const aggregate = new CustomProviderAggregate();
			const delegates = new Map<string, AuthProvider>();
			const context = storageContext();
			for (const [name, key] of Object.entries(entries)) {
				const delegate = new AuthProvider(name, name, context);
				await delegate.storeKey(`account-${name}`, name, key);
				await aggregate.addProvider(name, delegate);
				delegates.set(name, delegate);
			}
			return { aggregate, delegates };
		}

		test('a scoped read names one entry, an unscoped read is the union, and an ambiguous read has no answer', async () => {
			const { aggregate } = await aggregateWith({ 'my anthropic': 'sk-a', 'my openai': 'sk-o' });
			// The scope comes back stamped on every session, which is how the
			// caller tells whose key it was handed.
			const read = async (scopes?: string[]) =>
				(await aggregate.getSessions(scopes)).map(s => `${s.scopes.join('|')}=${s.accessToken}`);

			try {
				assert.deepStrictEqual({
					scoped: await read(['my anthropic']),
					noScopes: await read(undefined),
					emptyScopes: await read([]),
					unknownScope: await read(['not an entry']),
					twoScopes: await read(['my anthropic', 'my openai']),
				}, {
					scoped: ['my anthropic=sk-a'],
					noScopes: ['my anthropic=sk-a', 'my openai=sk-o'],
					emptyScopes: ['my anthropic=sk-a', 'my openai=sk-o'],
					unknownScope: [],
					// A lookup that cannot name one entry has no answer. The
					// union here would hand the caller some other endpoint's key.
					twoScopes: [],
				});
			} finally {
				aggregate.dispose();
			}
		});

		test('signing in names exactly one entry', async () => {
			const { aggregate } = await aggregateWith({ 'my anthropic': 'sk-a' });
			// The delegating path prompts for a key, so what is checked here is
			// the aggregate's own logic: which calls it refuses, and why.
			const refusal = async (scopes: string[]) => {
				try {
					await aggregate.createSession(scopes);
					return 'no error';
				} catch (err) {
					return (err as Error).message;
				}
			};

			try {
				assert.deepStrictEqual({
					none: await refusal([]),
					unknown: await refusal(['not an entry']),
					two: await refusal(['my anthropic', 'my openai']),
				}, {
					none: 'Adding a custom provider account here cannot tell which provider you mean. Use Configure LLM Providers instead.',
					unknown: 'No custom provider named "not an entry" is registered.',
					two: 'Signing in names exactly one custom provider, but 2 were given.',
				});
			} finally {
				aggregate.dispose();
			}
		});

		test('removing a session reaches the entry that owns it and no other', async () => {
			const { aggregate, delegates } = await aggregateWith({ 'my anthropic': 'sk-a', 'my openai': 'sk-o' });
			try {
				await aggregate.removeSession('account-my anthropic');
				assert.deepStrictEqual({
					anthropic: await delegates.get('my anthropic')!.getSessions(),
					openai: (await delegates.get('my openai')!.getSessions()).map(s => s.accessToken),
				}, {
					anthropic: [],
					openai: ['sk-o'],
				});
			} finally {
				aggregate.dispose();
			}
		});

		test('an entry leaving and coming back is reported, so no stale account is left behind', async () => {
			// The case that motivates it: a delegate removed while it still had
			// a live session. The shared provider stays registered and
			// AuthProvider.dispose() fires nothing, so if this event is missing
			// the account sits in the Accounts menu until the window reloads.
			const delegate = new AuthProvider('my anthropic', 'my anthropic', storageContext());
			await delegate.storeKey('account-1', 'my anthropic', 'sk-a');
			const aggregate = new CustomProviderAggregate();

			const seen: string[] = [];
			const subscription = aggregate.onDidChangeSessions(e => seen.push([
				`added:${(e.added ?? []).map(s => s.scopes.join('|')).join(',')}`,
				`removed:${(e.removed ?? []).map(s => s.scopes.join('|')).join(',')}`,
			].join(' ')));

			try {
				await aggregate.addProvider('my anthropic', delegate);
				const whileRegistered = await aggregate.getSessions(['my anthropic']);
				await aggregate.removeProvider('my anthropic');
				const whileGone = await aggregate.getSessions(['my anthropic']);
				await aggregate.addProvider('my anthropic', delegate);

				assert.deepStrictEqual({
					events: seen,
					whileRegistered: whileRegistered.length,
					whileGone: whileGone.length,
				}, {
					events: [
						'added:my anthropic removed:',
						'added: removed:my anthropic',
						'added:my anthropic removed:',
					],
					whileRegistered: 1,
					whileGone: 0,
				});
			} finally {
				subscription.dispose();
				aggregate.dispose();
			}
		});
	});

	suite('names', () => {
		test('the reserved names are every auth provider id the manifest declares', () => {
			const declared: string[] =
				vscode.extensions.getExtension('positron.authentication')!
					.packageJSON.contributes.authentication
					.map((entry: { id: string }) => entry.id);
			// The guard exists to protect configDialog's maps, which are keyed
			// by these ids, so a provider declared without being reserved is a
			// name a custom entry could still take over.
			assert.deepStrictEqual(
				[...reservedAuthProviderIdsForTest].sort(),
				declared.sort()
			);
		});

		test('a hand-written entry named after a built-in provider does not register, and leaves it intact', async () => {
			// Hand-written, not through the form: reconcile registers whatever
			// the catalog holds, so a guard that only sat in create() would let
			// this through and this test would pass with it in the wrong place.
			const builtin = new AuthProvider(ANTHROPIC_AUTH_PROVIDER_ID, 'Anthropic', storageContext());
			const validator = async () => { };
			registerAuthProvider(ANTHROPIC_AUTH_PROVIDER_ID, builtin, { validateApiKey: validator });

			writeConfig(configPath, {
				custom: {
					[ANTHROPIC_AUTH_PROVIDER_ID]: { type: 'anthropic' },
					[POSITRON_CUSTOM_AUTH_PROVIDER_ID]: { type: 'openai' },
					'My Gateway': { type: 'openai-compatible' },
				},
			});
			await initProviderCatalog(context, { configPath });
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } }),
				() => undefined,
				noSharedRegistration
			);

			try {
				await registry.reconcile();
				assert.deepStrictEqual({
					registered: registry.registeredIds,
					builtinUntouched: authProviders.get(ANTHROPIC_AUTH_PROVIDER_ID) === builtin,
					aggregateIdFree: authProviders.has(POSITRON_CUSTOM_AUTH_PROVIDER_ID),
				}, {
					registered: ['My Gateway'],
					builtinUntouched: true,
					aggregateIdFree: false,
				});
			} finally {
				registry.dispose();
				unregisterAuthProvider(ANTHROPIC_AUTH_PROVIDER_ID);
			}
		});

		test('the form refuses a reserved name and writes nothing', async () => {
			writeConfig(configPath, {});
			await initProviderCatalog(context, { configPath });
			const registry = new CustomProviderRegistry(
				storageContext(),
				() => ({ dispose: () => { } }),
				() => undefined,
				noSharedRegistration
			);

			try {
				await assert.rejects(
					registry.create({ name: ANTHROPIC_AUTH_PROVIDER_ID, kind: 'anthropic' }),
					/reserved for a built-in provider/
				);
				assert.strictEqual(readConfig(configPath).providers.custom, undefined);
			} finally {
				registry.dispose();
			}
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
				// The kind is what the modal shows the entry's vendor icon and
				// its Custom badge from.
				customKind: 'openai-compatible',
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
