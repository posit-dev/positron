/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getProviderSources, getRegistrableProviderSources, PROVIDER_METADATA } from '../providerSources';
import { POSITRON_CUSTOM_AUTH_PROVIDER_ID } from '../constants';
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
		// The shared custom-provider id is the one declared contribution that
		// isn't a provider in the catalogue. It exists so the id can be
		// allowlisted in product.json and activated on; it holds no credential
		// of its own, has no tile, and so has no metadata entry.
		const manifestIds = authPkg.contributes.authentication
			.map((c: { id: string }) => c.id)
			.filter((id: string) => id !== POSITRON_CUSTOM_AUTH_PROVIDER_ID);
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

suite('the legacy openai-compatible provider', () => {
	let dir: string;
	let configPath: string;
	let context: vscode.ExtensionContext;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-custom-provider-'));
		configPath = path.join(dir, 'providers.json');
		context = fakeContext();
	});

	teardown(() => {
		for (const d of context.subscriptions) {
			d.dispose();
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('getRegistrableProviderSources leaves it out when providers.json has no openai-compatible block', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath });

		const ids = getRegistrableProviderSources().map(s => s.provider.id);
		assert.ok(!ids.includes(PROVIDER_METADATA.customProvider.id));
	});

	test('getRegistrableProviderSources includes it once a baseUrl is saved under openai-compatible', async () => {
		writeConfig(configPath, { 'openai-compatible': { baseUrl: 'https://localhost:1337/v1' } });
		await initProviderCatalog(context, { configPath });

		const ids = getRegistrableProviderSources().map(s => s.provider.id);
		assert.ok(ids.includes(PROVIDER_METADATA.customProvider.id));
	});

	test('getProviderSources always includes it, so custom openai-compatible-kind entries still inherit its supportedOptions', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath });

		const ids = getProviderSources().map(s => s.provider.id);
		assert.ok(ids.includes(PROVIDER_METADATA.customProvider.id));
	});
});
