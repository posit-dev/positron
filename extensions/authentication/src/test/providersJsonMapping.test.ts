/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildProvidersConfigFromSettings, MIGRATABLE_SETTING_KEYS, MigrationSettingsReader } from '../migration/providersJson';

function readerOf(values: Record<string, unknown>): MigrationSettingsReader {
	return { globalValue: <T,>(key: string) => values[key] as T | undefined };
}

suite('buildProvidersConfigFromSettings', () => {
	test('returns undefined when nothing is set', () => {
		assert.strictEqual(buildProvidersConfigFromSettings(readerOf({})), undefined);
	});

	test('maps connection settings to provider blocks', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'authentication.anthropic.baseUrl': 'https://gateway.example.com',
			'authentication.anthropic.customHeaders': { 'x-team': 'data-science' },
			'authentication.openai-api.baseUrl': 'https://openai.example.com',
		}));
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
		}));
		// normalizeToV1Url appends the versioned path; assert against its real output.
		assert.ok(result?.config.providers?.['ms-foundry']?.baseUrl?.startsWith('https://my-resource.services.ai.azure.com'));
		assert.notStrictEqual(result?.config.providers?.['ms-foundry']?.baseUrl, 'https://my-resource.services.ai.azure.com');
	});

	test('omits empty strings and empty header maps', () => {
		assert.strictEqual(buildProvidersConfigFromSettings(readerOf({
			'authentication.anthropic.baseUrl': '',
			'authentication.anthropic.customHeaders': {},
		})), undefined);
	});

	test('maps grouped credential settings to their sections', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'authentication.aws.credentials': { AWS_PROFILE: 'default', AWS_REGION: 'us-east-1' },
			'authentication.googleVertex.credentials': { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_VERTEX_LOCATION: 'us-central1' },
			'authentication.snowflake.credentials': { SNOWFLAKE_ACCOUNT: 'MYORG-MYACCT', SNOWFLAKE_HOME: '/tmp/snow' },
		}));
		assert.deepStrictEqual(result?.config.providers?.bedrock, { aws: { profile: 'default', region: 'us-east-1' } });
		assert.deepStrictEqual(result?.config.providers?.['google-vertex'], { googleCloud: { project: 'my-project', location: 'us-central1' } });
		// SNOWFLAKE_HOME is NOT migrated yet (posit-dev/ai-lib#8).
		assert.deepStrictEqual(result?.config.providers?.['snowflake-cortex'], { snowflake: { account: 'MYORG-MYACCT' } });
	});

	test('maps enablement toggles with the newer generation winning', () => {
		const result = buildProvidersConfigFromSettings(readerOf({
			'positron.assistant.provider.anthropic.enable': false,
			'positron.assistant.provider.google.enable': true,
			'assistant.provider.deepseek.enabled': false,
		}));
		assert.strictEqual(result?.config.providers?.anthropic?.enabled, false);
		assert.strictEqual(result?.config.providers?.gemini?.enabled, true);
		assert.strictEqual(result?.config.providers?.deepseek?.enabled, false);
	});

	test('MIGRATABLE_SETTING_KEYS covers a spot-check of each family', () => {
		for (const key of [
			'authentication.anthropic.baseUrl',
			'authentication.aws.credentials',
			'authentication.snowflake.customHeaders',
			'positron.assistant.provider.githubCopilot.enable',
			'assistant.provider.googleVertex.enabled',
		]) {
			assert.ok(MIGRATABLE_SETTING_KEYS.includes(key), `missing ${key}`);
		}
	});
});
