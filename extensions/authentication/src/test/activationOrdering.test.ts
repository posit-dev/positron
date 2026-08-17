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
 * Covers the activation seam around the settings migrations and the catalog
 * prime: migrations must not abort each other or the prime, and the primed
 * catalog must not read legacy settings — the keys the settings migrations
 * write reach it only by way of the providers.json migration.
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

	// PROVIDER-SETTINGS-MIGRATION(legacy-positron): this Positron migrates
	// legacy settings into providers.json, so the catalog deliberately reads no
	// legacy `authentication.*` settings — a reader layer would make a cleared
	// providers.json value fall back to its stale legacy source. This pins the
	// drop: re-adding a reader to the catalog wiring must fail here.
	test('the primed catalog does not read legacy authentication.* settings', async () => {
		await vscode.workspace.getConfiguration('authentication.aws').update(
			'credentials',
			{ AWS_PROFILE: 'legacy-profile', AWS_REGION: 'eu-west-1' },
			vscode.ConfigurationTarget.Global
		);

		// envVars: {} keeps ambient AWS_PROFILE/AWS_REGION out of the
		// connection-env layer, so only the (absent) legacy layer could
		// contribute a profile; the region falls back to the built-in default.
		await migrateSettingsAndPrimeCatalog(context, { configPath, envVars: {} }, [], noopAutoMigrate);

		const aws = getCachedProvider('bedrock')?.connection.aws;
		assert.deepStrictEqual(
			{ profile: aws?.profile, region: aws?.region },
			{ profile: undefined, region: 'us-east-1' },
			'legacy settings must reach the catalog only via the providers.json migration'
		);
	});
});
