/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createAutomaticModelConfigs } from '../providers/index.js';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { CopilotModelProvider } from '../copilot.js';

suite('Autoconfigured Providers', () => {
	// Store original autoconfigure methods
	let originalAWSAutoconfigure: typeof AWSModelProvider.autoconfigure;
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	setup(() => {
		// Save originals
		originalAWSAutoconfigure = AWSModelProvider.autoconfigure;
		originalSnowflakeAutoconfigure = SnowflakeModelProvider.autoconfigure;
		originalCopilotAutoconfigure = CopilotModelProvider.autoconfigure;

		// Mock all Custom-type autoconfigure methods to return configured: true
		AWSModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Test AWS creds'
		});

		SnowflakeModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Test Snowflake creds',
			configuration: { apiKey: 'test-key', baseUrl: 'https://example.com' }
		});

		// CopilotModelProvider requires CopilotService singleton which isn't available in tests
		CopilotModelProvider.autoconfigure = async () => ({ configured: false });
	});

	teardown(() => {
		// Restore originals
		AWSModelProvider.autoconfigure = originalAWSAutoconfigure;
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
	});

	test('all autoconfigured providers include toolCalls: true', async () => {
		const configs = await createAutomaticModelConfigs();
		const failures: string[] = [];

		const expectedProviders = ['amazon-bedrock', 'snowflake-cortex'];
		for (const providerId of expectedProviders) {
			const config = configs.find((c) => c.provider === providerId);
			if (!config) {
				failures.push(`${providerId}: config not created`);
			} else if (config.toolCalls !== true) {
				failures.push(`${providerId}: toolCalls must be true`);
			}
		}

		assert.strictEqual(failures.length, 0, `Failures:\n${failures.join('\n')}`);
	});
});
