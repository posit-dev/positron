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

		const snowflakeConfig = configs.find(c => c.provider === 'snowflake-cortex');
		assert.ok(snowflakeConfig, 'Snowflake config should be created');
		assert.strictEqual(snowflakeConfig.toolCalls, true, 'Snowflake toolCalls should be true');
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
