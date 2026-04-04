/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment node

import { createAutomaticModelConfigs } from '../providers/index.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { CopilotModelProvider } from '../copilot.js';

describe('Autoconfigured Providers', () => {
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	beforeEach(() => {
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

	afterEach(() => {
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
	});

	it('autoconfigured providers include toolCalls: true', async () => {
		const configs = await createAutomaticModelConfigs();

		const snowflakeConfig = configs.find(c => c.provider === 'snowflake-cortex');
		expect(snowflakeConfig).toBeTruthy();
		expect(snowflakeConfig.toolCalls).toBe(true);
	});

	it('ANTHROPIC_BASE_URL env var populates baseUrl in autoconfigured model', async () => {
		const originalApiKey = process.env.ANTHROPIC_API_KEY;
		const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
		try {
			process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
			process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com';

			const configs = await createAutomaticModelConfigs();
			const anthropicConfig = configs.find((c) => c.provider === 'anthropic-api');
			expect(anthropicConfig).toBeTruthy();
			expect(anthropicConfig.baseUrl).toBe('https://proxy.example.com');
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

	it('no baseUrl when only ANTHROPIC_API_KEY is set', async () => {
		const originalApiKey = process.env.ANTHROPIC_API_KEY;
		const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
		try {
			process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
			delete process.env.ANTHROPIC_BASE_URL;

			const configs = await createAutomaticModelConfigs();
			const anthropicConfig = configs.find((c) => c.provider === 'anthropic-api');
			expect(anthropicConfig).toBeTruthy();
			expect(anthropicConfig.baseUrl).toBe(undefined);
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
