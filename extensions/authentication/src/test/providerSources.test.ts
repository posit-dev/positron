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
import { getCachedProvider, initProviderCatalog } from '../providerCatalog';

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

	test('the Bedrock AWS defaults come from providers.json', async () => {
		writeConfig(configPath, { bedrock: { aws: { profile: 'data-team', region: 'eu-west-1' } } });
		await initProviderCatalog(context, { configPath });

		const bedrock = getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.amazonBedrock.id
		);
		assert.deepStrictEqual(bedrock?.defaults.aws, { profile: 'data-team', region: 'eu-west-1' });
	});

	test('an environment-supplied AWS region stays out of the Bedrock defaults', async () => {
		// The form shows what the user durably controls. AWS_REGION outranks the
		// file when credentials resolve, but whether it reaches the extension
		// host at all depends on how Positron was launched -- so pre-filling it
		// would present an ambient value as a saved setting. It arrives as an
		// override instead, which the form renders read-only.
		writeConfig(configPath, {});
		await initProviderCatalog(context, {
			configPath,
			envVars: { AWS_REGION: 'us-east-2' },
		});

		const bedrock = getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.amazonBedrock.id
		);
		assert.deepStrictEqual(bedrock?.defaults.aws, {});
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

// Exercises getConnectionProvenance (providerCatalog.ts) through the seam its
// consumer uses, so these cover both the table and the source it lands on.
suite('getProviderSources connection provenance', () => {
	let dir: string;
	let configPath: string;
	let context: vscode.ExtensionContext;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-overrides-'));
		configPath = path.join(dir, 'providers.json');
		context = fakeContext();
	});

	teardown(() => {
		for (const d of context.subscriptions) {
			d.dispose();
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function bedrockSource() {
		return getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.amazonBedrock.id
		);
	}

	test('each set variable becomes an override naming itself', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, {
			configPath,
			envVars: { AWS_PROFILE: 'ci-runner', AWS_REGION: 'us-east-2' },
		});

		assert.deepStrictEqual(bedrockSource()?.overrides, {
			aws: {
				profile: { value: 'ci-runner', name: 'AWS_PROFILE' },
				region: { value: 'us-east-2', name: 'AWS_REGION' },
			},
		});
	});

	test('only the set variable is reported, leaving its sibling editable', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath, envVars: { AWS_REGION: 'us-east-2' } });

		assert.deepStrictEqual(bedrockSource()?.overrides, {
			aws: { region: { value: 'us-east-2', name: 'AWS_REGION' } },
		});
	});

	test('overrides are absent when no variable is set', async () => {
		writeConfig(configPath, { bedrock: { aws: { region: 'eu-west-1' } } });
		await initProviderCatalog(context, { configPath, envVars: {} });

		assert.strictEqual(bedrockSource()?.overrides, undefined);
	});

	test('a variable matching the saved value is still reported as an override', async () => {
		// The case a resolved-vs-user value diff cannot see. The variable
		// outranks the file whether or not the two agree, so the field is not
		// editable here -- detecting by presence rather than by difference is
		// what keeps the next save from being silently discarded.
		writeConfig(configPath, { bedrock: { aws: { region: 'us-east-2' } } });
		await initProviderCatalog(context, { configPath, envVars: { AWS_REGION: 'us-east-2' } });

		assert.deepStrictEqual(bedrockSource()?.overrides, {
			aws: { region: { value: 'us-east-2', name: 'AWS_REGION' } },
		});
	});

	test('an empty variable is treated as unset, matching ai-config', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath, envVars: { AWS_REGION: '' } });

		assert.strictEqual(bedrockSource()?.overrides, undefined);
	});

	test('a provider with no overridable fields reports none', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, { configPath, envVars: { AWS_REGION: 'us-east-2' } });

		const anthropic = getProviderSources().find(
			s => s.provider.id === PROVIDER_METADATA.anthropic.id
		);
		assert.strictEqual(anthropic?.overrides, undefined);
	});

	// Drift guard for OVERRIDING_ENV_VARS, which mirrors the subset of
	// ai-config's private CONNECTION_ENV_MAPPINGS whose fields the modal
	// renders. A type can't catch a rename or an added alias upstream, so this
	// asserts behaviorally that each variable we name really does reach the
	// resolved catalog. If ai-config renames AWS_REGION, this fails rather than
	// the form quietly showing an editable box for a shadowed field.
	test('every variable named as an override really does reach the resolved catalog', async () => {
		writeConfig(configPath, {});
		await initProviderCatalog(context, {
			configPath,
			envVars: { AWS_PROFILE: 'ci-runner', AWS_REGION: 'us-east-2' },
		});

		const overrides = bedrockSource()?.overrides ?? {};
		const resolved = getCachedProvider(PROVIDER_METADATA.amazonBedrock.catalogId!)?.connection.aws;
		assert.deepStrictEqual(
			{ profile: overrides.aws?.profile?.value, region: overrides.aws?.region?.value },
			{ profile: resolved?.profile, region: resolved?.region },
		);
	});
});
