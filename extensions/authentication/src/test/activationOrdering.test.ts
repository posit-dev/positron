/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { migrateSettingsAndPrimeCatalog } from '../extension';
import { migrateAwsSettings } from '../migration/aws';
import { migrateSnowflakeSettings } from '../migration/snowflake';
import { getCachedProvider } from '../providerCatalog';

/** Minimal ExtensionContext stub: only `subscriptions` is read by initProviderCatalog. */
function fakeContext(): vscode.ExtensionContext {
	return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** Stands in for the providers.json auto-migration; the real one reads live settings. */
function noopAutoMigrate(): Promise<void> {
	return Promise.resolve();
}

/**
 * Covers the ordering the AWS/Snowflake settings migrations and the catalog
 * prime have to keep: the catalog's legacy-settings layer reads the very keys
 * the migrations write, so priming first leaves the cache without the migrated
 * connection on a first run.
 */
suite('activation ordering', () => {
	let dir: string;
	let configPath: string;
	let context: vscode.ExtensionContext;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-ordering-'));
		configPath = path.join(dir, 'providers.json');
		fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers: {} }));
		context = fakeContext();
	});

	teardown(async () => {
		// Dispose the watcher registered on the (soon-deleted) tmpdir first, so
		// clearing the settings below can't refresh against a missing file.
		for (const d of context.subscriptions) {
			d.dispose();
		}
		fs.rmSync(dir, { recursive: true, force: true });
		await vscode.workspace.getConfiguration('authentication.aws')
			.update('credentials', undefined, vscode.ConfigurationTarget.Global);
		await vscode.workspace.getConfiguration('authentication.snowflake')
			.update('credentials', undefined, vscode.ConfigurationTarget.Global);
	});

	test('every migration finishes before the catalog reads settings', async () => {
		const order: string[] = [];

		await migrateSettingsAndPrimeCatalog(
			context,
			{
				configPath,
				// The catalog reads each legacy key through this reader during
				// the prime, so the first `get` marks when priming began.
				legacyPositronSettings: {
					get: () => {
						if (!order.includes('prime')) {
							order.push('prime');
						}
						return undefined;
					},
					watch: () => ({ dispose: () => { } }),
				},
			},
			[
				{ name: 'first', run: async () => { order.push('first'); } },
				{ name: 'second', run: async () => { order.push('second'); } },
			],
			noopAutoMigrate,
		);

		assert.deepStrictEqual(order, ['first', 'second', 'prime']);
	});

	test('a failing migration is logged and still lets the catalog prime', async () => {
		const order: string[] = [];

		await migrateSettingsAndPrimeCatalog(
			context,
			{ configPath },
			[
				{ name: 'throws', run: async () => { throw new Error('boom'); } },
				{ name: 'after', run: async () => { order.push('after'); } },
			],
			noopAutoMigrate,
		);

		assert.deepStrictEqual(order, ['after'], 'a rejected migration must not skip the ones after it');
		assert.ok(getCachedProvider('anthropic'), 'the catalog should still be primed');
	});

	test('the primed catalog picks up the AWS credentials the migration writes', async () => {
		// What migrateAwsSettings leaves behind, written directly: the old
		// positron.assistant.* keys it reads are no longer registered settings,
		// so a test can't create the pre-migration state through the config API.
		await vscode.workspace.getConfiguration('authentication.aws').update(
			'credentials',
			{ AWS_PROFILE: 'migrated-profile', AWS_REGION: 'eu-west-1' },
			vscode.ConfigurationTarget.Global
		);

		await migrateSettingsAndPrimeCatalog(
			context,
			{ configPath },
			[{ name: 'AWS', run: migrateAwsSettings }],
			noopAutoMigrate,
		);

		const aws = getCachedProvider('bedrock')?.connection.aws;
		assert.deepStrictEqual(
			{ profile: aws?.profile, region: aws?.region },
			{ profile: 'migrated-profile', region: 'eu-west-1' }
		);
	});

	test('the primed catalog picks up the Snowflake credentials the migration writes', async () => {
		await vscode.workspace.getConfiguration('authentication.snowflake').update(
			'credentials',
			{ SNOWFLAKE_ACCOUNT: 'migrated-account' },
			vscode.ConfigurationTarget.Global
		);

		await migrateSettingsAndPrimeCatalog(
			context,
			{ configPath },
			[{ name: 'Snowflake', run: migrateSnowflakeSettings }],
			noopAutoMigrate,
		);

		assert.strictEqual(
			getCachedProvider('snowflake-cortex')?.connection.snowflake?.account,
			'migrated-account'
		);
	});
});
