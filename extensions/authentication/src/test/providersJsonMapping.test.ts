/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildProvidersConfigFromSettings, InferCapabilitiesFn, MIGRATABLE_SETTING_KEYS, MigrationSettingsReader } from '../migration/providersJson';

function readerOf(values: Record<string, unknown>): MigrationSettingsReader {
	return { globalValue: <T,>(key: string) => values[key] as T | undefined };
}

const fakeCaps: InferCapabilitiesFn = () => ({
	maxContextLength: 128_000,
	supportsTools: true,
	supportsImages: false,
	supportsToolResultImages: false,
	supportsWebSearch: false,
});

suite('buildProvidersConfigFromSettings', () => {
	test('returns undefined when nothing is set', () => {
		assert.strictEqual(buildProvidersConfigFromSettings(readerOf({}), fakeCaps), undefined);
	});

	test('maps connection settings to provider blocks', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'authentication.anthropic.baseUrl': 'https://gateway.example.com',
			'authentication.anthropic.customHeaders': { 'x-team': 'data-science' },
			'authentication.openai-api.baseUrl': 'https://openai.example.com',
		}), fakeCaps);
		assert.deepStrictEqual(result?.config.providers?.anthropic, {
			baseUrl: 'https://gateway.example.com',
			customHeaders: { 'x-team': 'data-science' },
		});
		assert.deepStrictEqual(result?.config.providers?.openai, { baseUrl: 'https://openai.example.com' });
		assert.strictEqual(result?.settingCount, 3);
	});

	test('normalizes the foundry base URL', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'authentication.foundry.baseUrl': 'https://my-resource.services.ai.azure.com',
		}), fakeCaps);
		// normalizeToV1Url appends the versioned path; assert against its real output.
		assert.ok(result?.config.providers?.['ms-foundry']?.baseUrl?.startsWith('https://my-resource.services.ai.azure.com'));
		assert.notStrictEqual(result?.config.providers?.['ms-foundry']?.baseUrl, 'https://my-resource.services.ai.azure.com');
	});

	test('omits empty strings and empty header maps', () => {
		assert.strictEqual(buildProvidersConfigFromSettings(readerOf({
			'authentication.anthropic.baseUrl': '',
			'authentication.anthropic.customHeaders': {},
		}), fakeCaps), undefined);
	});

	test('maps grouped credential settings to their sections', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'authentication.aws.credentials': { AWS_PROFILE: 'default', AWS_REGION: 'us-east-1' },
			'authentication.googleVertex.credentials': { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_VERTEX_LOCATION: 'us-central1' },
			'authentication.snowflake.credentials': { SNOWFLAKE_ACCOUNT: 'MYORG-MYACCT', SNOWFLAKE_HOME: '/tmp/snow' },
		}), fakeCaps);
		assert.deepStrictEqual(result?.config.providers?.bedrock, { aws: { profile: 'default', region: 'us-east-1' } });
		assert.deepStrictEqual(result?.config.providers?.['google-vertex'], { googleCloud: { project: 'my-project', location: 'us-central1' } });
		assert.deepStrictEqual(result?.config.providers?.['snowflake-cortex'], { snowflake: { account: 'MYORG-MYACCT', home: '/tmp/snow' } });
	});

	test('records source-to-destination migrations with log-safe values', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'authentication.openai-api.baseUrl': 'https://openai.example.com',
			'authentication.openai-api.customHeaders': { 'x-api-key': 'sk-secret-token', 'x-team': 'data-science' },
			'authentication.aws.credentials': { AWS_PROFILE: 'default', AWS_REGION: 'us-east-1' },
		}), fakeCaps);
		assert.deepStrictEqual(result?.migrations, [
			{ source: 'authentication.openai-api.baseUrl', destination: 'providers.openai.baseUrl', value: '"https://openai.example.com"' },
			// Header values can carry auth tokens; only names are logged.
			{ source: 'authentication.openai-api.customHeaders', destination: 'providers.openai.customHeaders', value: '[x-api-key, x-team]' },
			{ source: 'authentication.aws.credentials', destination: 'providers.bedrock.aws.profile', value: '"default"' },
			{ source: 'authentication.aws.credentials', destination: 'providers.bedrock.aws.region', value: '"us-east-1"' },
		]);
		// The toast counts distinct source settings, not destination fields.
		assert.strictEqual(result?.settingCount, 3);
	});

	test('maps enablement toggles with the newer generation winning', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'positron.assistant.provider.anthropic.enable': false,
			'positron.assistant.provider.google.enable': true,
			'assistant.provider.deepseek.enabled': false,
		}), fakeCaps);
		assert.strictEqual(result?.config.providers?.anthropic?.enabled, false);
		assert.strictEqual(result?.config.providers?.gemini?.enabled, true);
		assert.strictEqual(result?.config.providers?.deepseek?.enabled, false);
	});

	test('converts model overrides to custom models with discovery off', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'positron.assistant.models.overrides.anthropic': [
				{ name: 'Sonnet (team)', identifier: 'claude-sonnet-4-5', maxInputTokens: 300_000 },
				{ identifier: 'missing-name' }, // malformed: skipped
			],
		}), fakeCaps);
		const models = result?.config.providers?.anthropic?.models;
		assert.strictEqual(models?.discovery, 'off');
		assert.strictEqual(models?.custom?.length, 1);
		const model = models.custom[0];
		assert.strictEqual(model.id, 'claude-sonnet-4-5');
		assert.strictEqual(model.name, 'Sonnet (team)');
		assert.strictEqual(model.maxInputTokens, 300_000);
		// maxContextLength floored at the user's maxInputTokens.
		assert.ok(model.maxContextLength >= 300_000);
	});

	test('an overrides array with only malformed entries maps nothing', () => {
		assert.strictEqual(buildProvidersConfigFromSettings(readerOf({
			'positron.assistant.models.overrides.openAI': [{ nope: true }],
		}), fakeCaps), undefined);
	});

	test('the real inferModelCapabilities satisfies the custom-model schema', async () => {
		const { inferModelCapabilities, customModelSchema } = await import('ai-config/node');
		const result = buildProvidersConfigFromSettings(readerOf({
			'positron.assistant.models.overrides.anthropic': [{ name: 'Sonnet', identifier: 'claude-sonnet-4-5' }],
		}), inferModelCapabilities);
		customModelSchema.parse(result?.config.providers?.anthropic?.models?.custom?.[0]);
	});

	test('every migratable setting maps to config the real ai-config schema accepts', async () => {
		const { inferModelCapabilities, providersConfigSchema } = await import('ai-config/node');
		const values: Record<string, unknown> = {};
		for (const key of MIGRATABLE_SETTING_KEYS) {
			if (key === 'authentication.aws.credentials') {
				values[key] = { AWS_PROFILE: 'default', AWS_REGION: 'us-east-1' };
			} else if (key === 'authentication.googleVertex.credentials') {
				values[key] = { GOOGLE_VERTEX_PROJECT: 'proj', GOOGLE_VERTEX_LOCATION: 'us-central1' };
			} else if (key === 'authentication.snowflake.credentials') {
				values[key] = { SNOWFLAKE_ACCOUNT: 'MYORG-MYACCT', SNOWFLAKE_HOME: '/opt/snowflake' };
			} else if (key.endsWith('.baseUrl')) {
				values[key] = 'https://gateway.example.com';
			} else if (key.endsWith('.customHeaders')) {
				values[key] = { 'x-team': 'data-science' };
			} else if (key.startsWith('positron.assistant.models.overrides.')) {
				values[key] = [{ name: 'Team Model', identifier: 'team-model-1', maxInputTokens: 100_000 }];
			} else if (key.endsWith('.enable') || key.endsWith('.enabled')) {
				values[key] = true;
			} else {
				assert.fail(`unhandled migratable key ${key}; add a branch with a realistic value`);
			}
		}
		const result = buildProvidersConfigFromSettings(readerOf(values), inferModelCapabilities);
		assert.ok(result, 'buildProvidersConfigFromSettings returned undefined');
		assert.strictEqual(result.settingCount, MIGRATABLE_SETTING_KEYS.length);
		providersConfigSchema.parse(result.config);
	});

	test('MIGRATABLE_SETTING_KEYS covers a spot-check of each family', () => {
		for (const key of [
			'authentication.anthropic.baseUrl',
			'authentication.aws.credentials',
			'authentication.snowflake.customHeaders',
			'positron.assistant.provider.githubCopilot.enable',
			'assistant.provider.googleVertex.enabled',
			'positron.assistant.models.overrides.positAI',
		]) {
			assert.ok(MIGRATABLE_SETTING_KEYS.includes(key), `missing ${key}`);
		}
	});
});
