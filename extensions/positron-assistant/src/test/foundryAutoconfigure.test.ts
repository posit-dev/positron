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
});
