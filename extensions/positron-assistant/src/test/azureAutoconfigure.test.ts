/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as positron from 'positron';
import { AzureModelProvider } from '../providers/azure/azureProvider.js';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { CopilotModelProvider } from '../copilot.js';
import { createAutomaticModelConfigs } from '../providers/index.js';
import { getAllModelDefinitions } from '../modelDefinitions.js';

suite('Azure Autoconfigure', () => {
	// Store original autoconfigure methods
	let originalAzureAutoconfigure: typeof AzureModelProvider.autoconfigure;
	let originalAWSAutoconfigure: typeof AWSModelProvider.autoconfigure;
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	setup(() => {
		// Save originals
		originalAzureAutoconfigure = AzureModelProvider.autoconfigure;
		originalAWSAutoconfigure = AWSModelProvider.autoconfigure;
		originalSnowflakeAutoconfigure = SnowflakeModelProvider.autoconfigure;
		originalCopilotAutoconfigure = CopilotModelProvider.autoconfigure;

		// Disable other providers' autoconfigure to isolate Azure tests
		AWSModelProvider.autoconfigure = async () => ({ configured: false });
		SnowflakeModelProvider.autoconfigure = async () => ({ configured: false });
		CopilotModelProvider.autoconfigure = async () => ({ configured: false });
	});

	teardown(() => {
		// Restore originals
		AzureModelProvider.autoconfigure = originalAzureAutoconfigure;
		AWSModelProvider.autoconfigure = originalAWSAutoconfigure;
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
		sinon.restore();
	});

	test('Azure autoconfigure produces config with toolCalls when configured', async () => {
		AzureModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Azure OpenAI (Workbench)',
		});

		const configs = await createAutomaticModelConfigs();
		const azureConfig = configs.find(c => c.provider === 'azure');

		assert.ok(azureConfig, 'Azure config should be created');
		assert.strictEqual(azureConfig.toolCalls, true, 'toolCalls should be true');
		assert.strictEqual(azureConfig.autoconfigure?.signedIn, true, 'signedIn should be true');
	});

	test('Azure autoconfigure not included when not configured', async () => {
		AzureModelProvider.autoconfigure = async () => ({
			configured: false,
		});

		const configs = await createAutomaticModelConfigs();
		const azureConfig = configs.find(c => c.provider === 'azure');

		assert.strictEqual(azureConfig, undefined, 'Azure config should not be created');
	});

	test('Azure builtInModelDefinitions includes expected models', () => {
		const models = getAllModelDefinitions('azure');
		assert.ok(models.length > 0, 'Azure should have built-in model definitions');

		const modelRouter = models.find(m => m.identifier === 'model-router');
		assert.ok(modelRouter, 'Model Router should be in built-in definitions');
		assert.strictEqual(modelRouter.maxInputTokens, 128_000);

		const gpt4o = models.find(m => m.identifier === 'gpt-4o');
		assert.ok(gpt4o, 'GPT-4o should be in built-in definitions');
		assert.strictEqual(gpt4o.maxInputTokens, 128_000);

		const gpt5mini = models.find(m => m.identifier === 'gpt-5-mini');
		assert.ok(gpt5mini, 'GPT-5 mini should be in built-in definitions');
		assert.strictEqual(gpt5mini.maxInputTokens, 272_000);
		assert.strictEqual(gpt5mini.maxOutputTokens, 128_000);
	});

	test('Azure source has Custom autoconfigure type', () => {
		const { autoconfigure } = AzureModelProvider.source.defaults;
		assert.ok(autoconfigure, 'autoconfigure should be defined in defaults');
		assert.strictEqual(autoconfigure!.type, positron.ai.LanguageModelAutoconfigureType.Custom);
		assert.strictEqual(autoconfigure!.signedIn, false, 'signedIn should default to false');
	});

	test('Existing providers (AWS/Snowflake) still work after Azure addition', async () => {
		// Re-enable AWS and Snowflake
		AWSModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'AWS creds'
		});
		SnowflakeModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Snowflake creds',
			configuration: { apiKey: 'test-key', baseUrl: 'https://example.com' }
		});
		AzureModelProvider.autoconfigure = async () => ({
			configured: false,
		});

		const configs = await createAutomaticModelConfigs();

		const awsConfig = configs.find(c => c.provider === 'amazon-bedrock');
		assert.ok(awsConfig, 'AWS config should still be created');

		const snowflakeConfig = configs.find(c => c.provider === 'snowflake-cortex');
		assert.ok(snowflakeConfig, 'Snowflake config should still be created');
	});
});
