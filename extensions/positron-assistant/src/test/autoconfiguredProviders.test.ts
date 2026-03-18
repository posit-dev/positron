/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createAutomaticModelConfigs } from '../providers/index.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { CopilotModelProvider } from '../copilot.js';

suite('Autoconfigured Providers', () => {
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	setup(() => {
		originalSnowflakeAutoconfigure = SnowflakeModelProvider.autoconfigure;
		originalCopilotAutoconfigure = CopilotModelProvider.autoconfigure;

		SnowflakeModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Test Snowflake creds',
			configuration: { apiKey: 'test-key', baseUrl: 'https://example.com' }
		});

		// CopilotModelProvider requires CopilotService singleton which isn't available in tests
		CopilotModelProvider.autoconfigure = async () => ({ configured: false });
	});

	teardown(() => {
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
	});

	test('autoconfigured providers include toolCalls: true', async () => {
		const configs = await createAutomaticModelConfigs();

		// AWS and Foundry no longer use autoconfigure; they use
		// session-based registration via registerModelsForProvider.
		const awsConfig = configs.find(c => c.provider === 'amazon-bedrock');
		assert.strictEqual(awsConfig, undefined, 'AWS should not be auto-configured');

		const foundryConfig = configs.find(c => c.provider === 'ms-foundry');
		assert.strictEqual(foundryConfig, undefined, 'Foundry should not be auto-configured');

		// Snowflake still uses autoconfigure
		const snowflakeConfig = configs.find(c => c.provider === 'snowflake-cortex');
		assert.ok(snowflakeConfig, 'Snowflake config should be created');
		assert.strictEqual(snowflakeConfig.toolCalls, true, 'Snowflake toolCalls should be true');
	});
});
