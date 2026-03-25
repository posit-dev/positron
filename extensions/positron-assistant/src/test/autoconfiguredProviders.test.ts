/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createAutomaticModelConfigs } from '../providers/index.js';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { FoundryModelProvider } from '../providers/foundry/foundryProvider.js';
import { CopilotModelProvider } from '../copilot.js';

suite('Autoconfigured Providers', () => {
	// Store original autoconfigure methods
	let originalAWSAutoconfigure: typeof AWSModelProvider.autoconfigure;
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalFoundryAutoconfigure: typeof FoundryModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	setup(() => {
		// Save originals
		originalAWSAutoconfigure = AWSModelProvider.autoconfigure;
		originalSnowflakeAutoconfigure = SnowflakeModelProvider.autoconfigure;
		originalFoundryAutoconfigure = FoundryModelProvider.autoconfigure;
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

		FoundryModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Test Foundry creds'
		});

		// CopilotModelProvider requires CopilotService singleton which isn't available in tests
		CopilotModelProvider.autoconfigure = async () => ({ configured: false });
	});

	teardown(() => {
		// Restore originals
		AWSModelProvider.autoconfigure = originalAWSAutoconfigure;
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		FoundryModelProvider.autoconfigure = originalFoundryAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
	});

	test('all autoconfigured providers include toolCalls: true', async () => {
		const configs = await createAutomaticModelConfigs();
		const failures: string[] = [];

		const expectedProviders = ['amazon-bedrock', 'snowflake-cortex', 'ms-foundry'];
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

	test('ANTHROPIC_BASE_URL env var populates baseUrl in autoconfigured model', async () => {
		const originalApiKey = process.env.ANTHROPIC_API_KEY;
		const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
		try {
			process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
			process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com';

			const configs = await createAutomaticModelConfigs();
			const anthropicConfig = configs.find((c) => c.provider === 'anthropic-api');
			assert.ok(anthropicConfig, 'Anthropic config should be created');
			assert.strictEqual(anthropicConfig.baseUrl, 'https://proxy.example.com');
		} finally {
			if (originalApiKey === undefined) {
				delete process.env.ANTHROPIC_API_KEY;
			} else {
				process.env.ANTHROPIC_API_KEY = originalApiKey;
			}
			if (originalBaseUrl === undefined) {
				delete process.env.ANTHROPIC_BASE_URL;
			} else {
				process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
			}
		}
	});

	test('no baseUrl when only ANTHROPIC_API_KEY is set', async () => {
		const originalApiKey = process.env.ANTHROPIC_API_KEY;
		const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
		try {
			process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
			delete process.env.ANTHROPIC_BASE_URL;

			const configs = await createAutomaticModelConfigs();
			const anthropicConfig = configs.find((c) => c.provider === 'anthropic-api');
			assert.ok(anthropicConfig, 'Anthropic config should be created');
			assert.strictEqual(anthropicConfig.baseUrl, undefined);
		} finally {
			if (originalApiKey === undefined) {
				delete process.env.ANTHROPIC_API_KEY;
			} else {
				process.env.ANTHROPIC_API_KEY = originalApiKey;
			}
			if (originalBaseUrl === undefined) {
				delete process.env.ANTHROPIC_BASE_URL;
			} else {
				process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
			}
		}
	});
});
