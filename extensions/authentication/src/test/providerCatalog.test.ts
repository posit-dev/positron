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
	saveProviderEnabled,
	saveSnowflakeAccount,
} from '../providerCatalog';
import { removeTempDir } from './tempDir';

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

	teardown(async () => {
		// Dispose the watcher registered on the (soon-deleted) tmpdir.
		for (const d of context.subscriptions) {
			d.dispose();
		}
		await removeTempDir(dir);
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

	test('the cached provider carries its models block', async () => {
		writeConfig(configPath, { anthropic: { models: { discovery: 'off' } } });
		await initProviderCatalog(context, { configPath });

		assert.deepStrictEqual(getCachedProvider('anthropic')?.models, { discovery: 'off' });
	});

	// The only test here that depends on fs.watch delivery. Delivery is normally
	// ~700ms (300ms debounce plus the settle) but has been observed taking
	// several seconds under extension-host load, so the wait is deliberately
	// generous: a slow delivery should read as a slow pass, not a red build. A
	// timeout at this length means the event was never delivered at all, which
	// is a real defect rather than contention.
	test('a file edit fires onDidChangeProviderCatalog with the changed provider id', async function () {
		this.timeout(30000);
		writeConfig(configPath, { anthropic: { baseUrl: 'https://original.example.com' } });
		await initProviderCatalog(context, { configPath });
		await settle();

		let baseUrlInsideListener: string | undefined;
		const changePromise = nextCatalogChange(() => {
			baseUrlInsideListener = getCachedProvider('anthropic')?.connection.baseUrl;
		}, 20000);

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

	test('disabling a provider surfaces it in disabledIds', async () => {
		writeConfig(configPath, { anthropic: { enabled: true } });
		await initProviderCatalog(context, { configPath });
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, true);

		// Write through a save helper instead of waiting on the file watcher.
		// Both reload paths share the disabledIds diff, so this covers it with no
		// dependence on fs.watch delivery latency. The watcher's own delivery is
		// covered by the file-edit test above.
		let payload: Parameters<Parameters<typeof onDidChangeProviderCatalog>[0]>[0] | undefined;
		const sub = onDidChangeProviderCatalog(p => { payload = p; });

		await saveProviderEnabled('anthropic', false, false, { configPath });
		sub.dispose();

		assert.ok(payload?.disabledIds.includes('anthropic'), 'disabledIds should include anthropic');
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, false);
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

	// PROVIDER-SETTINGS-MIGRATION(legacy-positron): delete with the loader
	// option when Workbench drops support for Positron 2026.07. The cache opts
	// into the legacy admin channel only; user-set legacy settings never reach it.
	test('POSITRON_ENFORCED_SETTINGS applies above the user file without any reader wiring', async () => {
		writeConfig(configPath, { anthropic: { baseUrl: 'https://user-file.example.com' } });

		await initProviderCatalog(context, {
			configPath,
			envVars: {
				POSITRON_ENFORCED_SETTINGS: JSON.stringify({
					'authentication.anthropic.baseUrl': 'https://enforced.example.com',
				}),
			},
		});

		assert.strictEqual(
			getCachedProvider('anthropic')?.connection.baseUrl,
			'https://enforced.example.com',
			'the legacy admin channel must beat the user file'
		);
	});

	test('saveProviderEnabled with onlyIfUnset does not clobber an existing enabled value', async () => {
		writeConfig(configPath, { anthropic: { enabled: false } });
		await initProviderCatalog(context, { configPath });

		const wrote = await saveProviderEnabled('anthropic', true, true, { configPath });

		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.enabled, false, 'onlyIfUnset must not overwrite an existing value');
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, false);
		assert.strictEqual(wrote, false, 'a skipped write must report itself, so callers can log what they did');
	});

	test('saveProviderEnabled reports a write it did perform', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath });

		const wrote = await saveProviderEnabled('anthropic', false, true, { configPath });

		assert.strictEqual(wrote, true);
		assert.strictEqual(getCachedProvider('anthropic')?.enabled, false);
	});
});
