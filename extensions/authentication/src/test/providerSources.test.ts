/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getProviderSources, PROVIDER_METADATA } from '../providerSources';
import { initProviderCatalog } from '../providerCatalog';

/**
 * Guards against drift between PROVIDER_METADATA in providerSources.ts and the
 * `contributes.authentication` entries in this extension's package.json: adding
 * an auth provider to the manifest without a matching metadata entry is the
 * drift we want to catch.
 */
suite('PROVIDER_METADATA package.json consistency', () => {

	function readPackageJson(...segments: string[]): any {
		const file = path.join(__dirname, '..', '..', ...segments);
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}

	const authPkg = readPackageJson('package.json');

	test('every authentication contribution has a PROVIDER_METADATA entry', () => {
		// `label` (Accounts menu) and `displayName` (model picker) are deliberately
		// allowed to differ per provider, so we don't couple them. What we do
		// enforce is that every declared auth provider is known to the metadata:
		// adding a contribution to package.json without a matching entry here is
		// the drift we want to catch. Providers without a contribution (e.g.
		// copilot, which rides GitHub's auth) aren't required to appear.
		const metadataIds = Object.values(PROVIDER_METADATA).map(p => p.id);
		const manifestIds = authPkg.contributes.authentication.map((c: { id: string }) => c.id);
		const resolved = manifestIds.filter((id: string) => metadataIds.includes(id));

		assert.deepStrictEqual(resolved, manifestIds);
	});

	test('Databricks is catalog-backed and marked experimental', () => {
		assert.deepStrictEqual(PROVIDER_METADATA.databricks, {
			id: 'databricks',
			displayName: 'Databricks',
			status: 'experimental',
			catalogId: 'databricks',
		});
	});
});

/** Minimal ExtensionContext stub: only `subscriptions` is read by initProviderCatalog. */
function fakeContext(): vscode.ExtensionContext {
	return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function writeConfig(configPath: string, providers: Record<string, unknown>): void {
	fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers }));
}

suite('getProviderSources baseUrl defaults from the catalog', () => {
	let dir: string;
	let configPath: string;
	let context: vscode.ExtensionContext;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-sources-'));
		configPath = path.join(dir, 'providers.json');
		context = fakeContext();
	});

	teardown(() => {
		for (const d of context.subscriptions) {
			d.dispose();
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('a saved catalog baseUrl overrides the per-provider default literal', async () => {
		writeConfig(configPath, { anthropic: { baseUrl: 'https://gateway.example.com' } });
		await initProviderCatalog(context, { configPath });

		const anthropic = getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.anthropic.id
		);
		assert.strictEqual(anthropic?.defaults.baseUrl, 'https://gateway.example.com');
	});

	test('Databricks offers a personal access token and the workspace URL', async () => {
		await initProviderCatalog(context, { configPath });

		const databricks = getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.databricks.id
		);
		assert.deepStrictEqual(databricks?.supportedOptions, ['apiKey', 'baseUrl']);
	});

	test('the Databricks workspace URL default comes from the catalog host', async () => {
		writeConfig(configPath, {
			databricks: { databricks: { host: 'https://adb-123.4.azuredatabricks.net' } },
		});
		await initProviderCatalog(context, { configPath });

		const databricks = getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.databricks.id
		);
		assert.strictEqual(databricks?.defaults.baseUrl, 'https://adb-123.4.azuredatabricks.net');
	});
});
