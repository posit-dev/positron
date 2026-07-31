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
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	refreshProviderCatalog,
	removeProviderBlock,
	saveCustomProviderModels,
	saveProviderBaseUrl,
	saveProviderEnabled,
	saveSnowflakeAccount,
} from '../providerCatalog';

/** Minimal ExtensionContext stub: only `subscriptions` is read by initProviderCatalog. */
function fakeContext(): vscode.ExtensionContext {
	return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** Waits for the next onDidChangeProviderCatalog event or rejects after `ms`. */
function nextCatalogChange(
	onEvent?: (payload: Parameters<Parameters<typeof onDidChangeProviderCatalog>[0]>[0]) => void,
	ms = 5000
): Promise<Parameters<Parameters<typeof onDidChangeProviderCatalog>[0]>[0]> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			sub.dispose();
			reject(new Error('Timed out waiting for onDidChangeProviderCatalog'));
		}, ms);
		const sub = onDidChangeProviderCatalog(payload => {
			onEvent?.(payload);
			clearTimeout(timer);
			sub.dispose();
			resolve(payload);
		});
	});
}

function writeConfig(configPath: string, providers: Record<string, unknown>): void {
	fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers }));
}

/** Lets the watcher's initial rebuild settle before an external edit is made. */
function settle(ms = 400): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

suite('providerCatalog', () => {
	let dir: string;
	let configPath: string;
	let context: vscode.ExtensionContext;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-catalog-'));
		configPath = path.join(dir, 'providers.json');
		context = fakeContext();
	});

	teardown(() => {
		// Dispose the watcher registered on the (soon-deleted) tmpdir.
		for (const d of context.subscriptions) {
			d.dispose();
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('init loads the baseline catalog and getCachedProvider answers synchronously', async () => {
		writeConfig(configPath, { anthropic: { baseUrl: 'https://gateway.example.com' } });
		await initProviderCatalog(context, { configPath });

		const anthropic = getCachedProvider('anthropic');
		assert.ok(anthropic, 'anthropic should be cached after init');
		assert.strictEqual(anthropic.id, 'anthropic');
		assert.strictEqual(anthropic.connection.baseUrl, 'https://gateway.example.com');
		assert.strictEqual(getCachedProvider('does-not-exist'), undefined);
	});

	test('a file edit fires onDidChangeProviderCatalog with the changed provider id', async function () {
		this.timeout(10000);
		writeConfig(configPath, { anthropic: { baseUrl: 'https://original.example.com' } });
		await initProviderCatalog(context, { configPath });
		await settle();

		let baseUrlInsideListener: string | undefined;
		const changePromise = nextCatalogChange(() => {
			baseUrlInsideListener = getCachedProvider('anthropic')?.connection.baseUrl;
		});

		writeConfig(configPath, { anthropic: { baseUrl: 'https://changed.example.com' } });

		const change = await changePromise;
		assert.ok(
			change.changedConnectionIds.includes('anthropic'),
			'changedConnectionIds should include anthropic'
		);
		assert.strictEqual(
			baseUrlInsideListener,
			'https://changed.example.com',
			'cache should already reflect the new baseUrl inside the listener'
		);
	});

	test('disabling a provider surfaces it in disabledIds', async function () {
		this.timeout(10000);
		writeConfig(configPath, { anthropic: { enabled: true } });
		await initProviderCatalog(context, { configPath });
		await settle();
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, true);

		const changePromise = nextCatalogChange();
		writeConfig(configPath, { anthropic: { enabled: false } });

		const change = await changePromise;
		assert.ok(change.disabledIds.includes('anthropic'), 'disabledIds should include anthropic');
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, false);
	});

	test('refreshProviderCatalog picks up a just-written file without waiting for the watcher', async () => {
		writeConfig(configPath, { anthropic: { baseUrl: 'https://one.example.com' } });
		await initProviderCatalog(context, { configPath });

		writeConfig(configPath, { anthropic: { baseUrl: 'https://two.example.com' } });
		await refreshProviderCatalog();

		assert.strictEqual(getCachedProvider('anthropic')?.connection.baseUrl, 'https://two.example.com');
	});

	test('refreshProviderCatalog fires the change event with the same per-provider diff an external edit would', async () => {
		writeConfig(configPath, { anthropic: { baseUrl: 'https://one.example.com' } });
		await initProviderCatalog(context, { configPath });

		let payload: Parameters<Parameters<typeof onDidChangeProviderCatalog>[0]>[0] | undefined;
		const sub = onDidChangeProviderCatalog(p => { payload = p; });

		writeConfig(configPath, { anthropic: { baseUrl: 'https://three.example.com' } });
		await refreshProviderCatalog();
		sub.dispose();

		assert.ok(payload, 'refresh should fire the change event');
		assert.deepStrictEqual(payload.changedConnectionIds, ['anthropic']);
		assert.deepStrictEqual(payload.disabledIds, []);
	});

	test('saveProviderBaseUrl writes providers.<id>.baseUrl and the cache reflects it immediately', async () => {
		writeConfig(configPath, { anthropic: {} });
		await initProviderCatalog(context, { configPath });

		await saveProviderBaseUrl('anthropic', 'https://saved.example.com', { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.baseUrl, 'https://saved.example.com');
		assert.strictEqual(getCachedProvider('anthropic')?.connection.baseUrl, 'https://saved.example.com');
	});

	test('saveProviderBaseUrl appends the version segment when the bare public host is saved', async () => {
		writeConfig(configPath, { anthropic: {} });
		await initProviderCatalog(context, { configPath });

		// Bare host (with a stray trailing slash) is rewritten to the versioned form.
		await saveProviderBaseUrl('anthropic', 'https://api.anthropic.com/', { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.baseUrl, 'https://api.anthropic.com/v1');
	});

	test('saveProviderBaseUrl leaves a custom host untouched', async () => {
		writeConfig(configPath, { anthropic: {} });
		await initProviderCatalog(context, { configPath });

		// A proxy / non-public host is not the bare known host, so it passes through.
		await saveProviderBaseUrl('anthropic', 'https://my-proxy.example.com', { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.baseUrl, 'https://my-proxy.example.com');
	});

	test('saveCustomProviderModels writes protocol and models.custom with discovery off', async () => {
		writeConfig(configPath, { 'openai-compatible': { baseUrl: 'https://proxy.example/v1' } });
		await initProviderCatalog(context, { configPath });

		const models = [
			{ id: 'm1', name: 'm1', maxContextLength: 128000, supportsTools: true, supportsImages: false, supportsToolResultImages: false, supportsWebSearch: false },
		];
		await saveCustomProviderModels('openai-compatible', 'anthropic-messages', models, { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.deepStrictEqual(written.providers['openai-compatible'], {
			baseUrl: 'https://proxy.example/v1',
			protocol: 'anthropic-messages',
			models: { discovery: 'off', custom: models },
		});
	});

	test('saveCustomProviderModels ignores an unknown protocol and leaves models untouched when the list is empty', async () => {
		writeConfig(configPath, { 'openai-compatible': { baseUrl: 'https://proxy.example/v1' } });
		await initProviderCatalog(context, { configPath });

		await saveCustomProviderModels('openai-compatible', 'not-a-protocol', [], { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.deepStrictEqual(written.providers['openai-compatible'], { baseUrl: 'https://proxy.example/v1' });
	});

	test('removeProviderBlock drops the whole block and leaves the others alone', async () => {
		writeConfig(configPath, {
			'openai-compatible': { baseUrl: 'https://proxy.example/v1', protocol: 'anthropic-messages' },
			anthropic: { baseUrl: 'https://gateway.example.com' },
		});
		await initProviderCatalog(context, { configPath });

		await removeProviderBlock('openai-compatible', { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.deepStrictEqual(written.providers, { anthropic: { baseUrl: 'https://gateway.example.com' } });
	});

	test('saveSnowflakeAccount writes the snowflake account field, only when changed', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath });

		await saveSnowflakeAccount('acme-account', { configPath });
		let written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers['snowflake-cortex'].snowflake.account, 'acme-account');
		assert.strictEqual(getCachedProvider('snowflake-cortex')?.connection.snowflake?.account, 'acme-account');

		const mtimeBefore = fs.statSync(configPath).mtimeMs;
		await new Promise(resolve => setTimeout(resolve, 10));
		await saveSnowflakeAccount('acme-account', { configPath });
		written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers['snowflake-cortex'].snowflake.account, 'acme-account');
		assert.strictEqual(fs.statSync(configPath).mtimeMs, mtimeBefore, 'unchanged account should not rewrite the file');
	});

	test('legacyPositronSettings fills gaps below the user file, and the user file wins', async () => {
		// User file configures anthropic only.
		writeConfig(configPath, { anthropic: { baseUrl: 'https://user-file.example.com' } });

		// Legacy settings set the same anthropic field (must lose to the user
		// file) plus an openai field the user file never mentions (must surface).
		const legacy: Record<string, unknown> = {
			'authentication.anthropic.baseUrl': 'https://legacy-anthropic.example.com',
			'authentication.openai-api.baseUrl': 'https://legacy-openai.example.com',
		};
		await initProviderCatalog(context, {
			configPath,
			legacyPositronSettings: {
				get: key => legacy[key],
				watch: () => ({ dispose: () => { } }),
			},
		});

		assert.strictEqual(
			getCachedProvider('anthropic')?.connection.baseUrl,
			'https://user-file.example.com',
			'user file must win over the legacy layer'
		);
		assert.strictEqual(
			getCachedProvider('openai')?.connection.baseUrl,
			'https://legacy-openai.example.com',
			'legacy layer must fill a provider the user file omits'
		);
	});

	test('saveProviderEnabled with onlyIfUnset does not clobber an existing enabled value', async () => {
		writeConfig(configPath, { anthropic: { enabled: false } });
		await initProviderCatalog(context, { configPath });

		await saveProviderEnabled('anthropic', true, true, { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.enabled, false, 'onlyIfUnset must not overwrite an existing value');
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, false);
	});
});
