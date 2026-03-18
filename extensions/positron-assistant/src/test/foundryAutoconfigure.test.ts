/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FoundryModelProvider } from '../providers/foundry/foundryProvider.js';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { CopilotModelProvider } from '../copilot.js';
import { createAutomaticModelConfigs } from '../providers/index.js';

suite('Foundry Provider', () => {
	// Store original autoconfigure methods for providers that still have them
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	setup(() => {
		originalSnowflakeAutoconfigure = SnowflakeModelProvider.autoconfigure;
		originalCopilotAutoconfigure = CopilotModelProvider.autoconfigure;

		SnowflakeModelProvider.autoconfigure = async () => ({ configured: false });
		CopilotModelProvider.autoconfigure = async () => ({ configured: false });
	});

	teardown(() => {
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
	});

	test('Foundry and AWS do not appear in createAutomaticModelConfigs', async () => {
		const configs = await createAutomaticModelConfigs();
		const foundryConfig = configs.find(c => c.provider === 'ms-foundry');
		const awsConfig = configs.find(c => c.provider === 'amazon-bedrock');

		assert.strictEqual(foundryConfig, undefined, 'Foundry should not be auto-configured');
		assert.strictEqual(awsConfig, undefined, 'AWS should not be auto-configured');
	});

	test('Foundry source does not have autoconfigure in defaults', () => {
		assert.strictEqual(
			FoundryModelProvider.source.defaults.autoconfigure,
			undefined,
			'Foundry should not have autoconfigure in defaults'
		);
	});

	test('AWS source does not have autoconfigure in defaults', () => {
		assert.strictEqual(
			AWSModelProvider.source.defaults.autoconfigure,
			undefined,
			'AWS should not have autoconfigure in defaults'
		);
	});

	test('Snowflake autoconfigure still works', async () => {
		SnowflakeModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Snowflake creds',
			configuration: { apiKey: 'test-key', baseUrl: 'https://example.com' }
		});

		const configs = await createAutomaticModelConfigs();
		const snowflakeConfig = configs.find(c => c.provider === 'snowflake-cortex');
		assert.ok(snowflakeConfig, 'Snowflake config should still be created');
	});

	// --- URL normalization tests ---

	suite('normalizeToV1Url', () => {
		test('converts full deployment URL to v1', () => {
			const input = 'https://r.azure.com/openai/deployments/m/chat/completions?api-version=2025-01-01-preview';
			assert.strictEqual(FoundryModelProvider.normalizeToV1Url(input), 'https://r.azure.com/openai/v1');
		});

		test('converts partial deployment URL to v1', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url('https://r.azure.com/openai/deployments/m'),
				'https://r.azure.com/openai/v1'
			);
		});

		test('preserves already-v1 URL', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url('https://r.azure.com/openai/v1'),
				'https://r.azure.com/openai/v1'
			);
		});

		test('strips trailing slash from v1 URL', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url('https://r.azure.com/openai/v1/'),
				'https://r.azure.com/openai/v1'
			);
		});

		test('appends /openai/v1 to bare endpoint with trailing slash', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url('https://r.azure.com/'),
				'https://r.azure.com/openai/v1'
			);
		});

		test('appends /openai/v1 to bare endpoint', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url('https://r.azure.com'),
				'https://r.azure.com/openai/v1'
			);
		});

		test('strips query params from bare endpoint', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url('https://r.azure.com?api-version=x'),
				'https://r.azure.com/openai/v1'
			);
		});

		test('handles empty string', () => {
			assert.strictEqual(
				FoundryModelProvider.normalizeToV1Url(''),
				''
			);
		});
	});

	suite('isDeploymentUrl', () => {
		test('detects full deployment URL', () => {
			assert.strictEqual(
				FoundryModelProvider.isDeploymentUrl('https://r.azure.com/openai/deployments/m/chat/completions'),
				true
			);
		});

		test('returns false for v1 URL', () => {
			assert.strictEqual(
				FoundryModelProvider.isDeploymentUrl('https://r.azure.com/openai/v1'),
				false
			);
		});

		test('returns false for bare endpoint', () => {
			assert.strictEqual(
				FoundryModelProvider.isDeploymentUrl('https://r.azure.com/'),
				false
			);
		});
	});
});
