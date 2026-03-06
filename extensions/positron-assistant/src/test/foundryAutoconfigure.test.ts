/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as positron from 'positron';
import { FoundryModelProvider } from '../providers/foundry/foundryProvider.js';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider.js';
import { SnowflakeModelProvider } from '../providers/snowflake/snowflakeProvider.js';
import { CopilotModelProvider } from '../copilot.js';
import { createAutomaticModelConfigs } from '../providers/index.js';
import * as pwbModule from '../pwb.js';

suite('Foundry Autoconfigure', () => {
	// Store original autoconfigure methods
	let originalFoundryAutoconfigure: typeof FoundryModelProvider.autoconfigure;
	let originalAWSAutoconfigure: typeof AWSModelProvider.autoconfigure;
	let originalSnowflakeAutoconfigure: typeof SnowflakeModelProvider.autoconfigure;
	let originalCopilotAutoconfigure: typeof CopilotModelProvider.autoconfigure;

	setup(() => {
		// Save originals
		originalFoundryAutoconfigure = FoundryModelProvider.autoconfigure;
		originalAWSAutoconfigure = AWSModelProvider.autoconfigure;
		originalSnowflakeAutoconfigure = SnowflakeModelProvider.autoconfigure;
		originalCopilotAutoconfigure = CopilotModelProvider.autoconfigure;

		// Disable other providers' autoconfigure to isolate Foundry tests
		AWSModelProvider.autoconfigure = async () => ({ configured: false });
		SnowflakeModelProvider.autoconfigure = async () => ({ configured: false });
		CopilotModelProvider.autoconfigure = async () => ({ configured: false });
	});

	teardown(() => {
		// Restore originals
		FoundryModelProvider.autoconfigure = originalFoundryAutoconfigure;
		AWSModelProvider.autoconfigure = originalAWSAutoconfigure;
		SnowflakeModelProvider.autoconfigure = originalSnowflakeAutoconfigure;
		CopilotModelProvider.autoconfigure = originalCopilotAutoconfigure;
		sinon.restore();
	});

	test('Foundry autoconfigure produces config with toolCalls when configured', async () => {
		FoundryModelProvider.autoconfigure = async () => ({
			configured: true,
			message: 'Microsoft Foundry (Workbench)',
		});

		const configs = await createAutomaticModelConfigs();
		const foundryConfig = configs.find(c => c.provider === 'ms-foundry');

		assert.ok(foundryConfig, 'Foundry config should be created');
		assert.strictEqual(foundryConfig.toolCalls, true, 'toolCalls should be true');
		assert.strictEqual(foundryConfig.autoconfigure?.signedIn, true, 'signedIn should be true');
	});

	test('Foundry autoconfigure not included when not configured', async () => {
		FoundryModelProvider.autoconfigure = async () => ({
			configured: false,
		});

		const configs = await createAutomaticModelConfigs();
		const foundryConfig = configs.find(c => c.provider === 'ms-foundry');

		assert.strictEqual(foundryConfig, undefined, 'Foundry config should not be created');
	});

	test('Foundry source has Custom autoconfigure type', () => {
		const { autoconfigure } = FoundryModelProvider.source.defaults;
		assert.ok(autoconfigure, 'autoconfigure should be defined in defaults');
		assert.strictEqual(autoconfigure!.type, positron.ai.LanguageModelAutoconfigureType.Custom);
		assert.strictEqual(autoconfigure!.signedIn, false, 'signedIn should default to false');
	});

	test('autoconfigure returns configured:false when hasManagedCredentials returns false', async () => {
		// Restore original autoconfigure so the real implementation runs
		FoundryModelProvider.autoconfigure = originalFoundryAutoconfigure;
		sinon.stub(pwbModule, 'hasManagedCredentials').returns(false);

		const result = await FoundryModelProvider.autoconfigure();
		assert.strictEqual(result.configured, false);
	});

	test('autoconfigure returns configured:true when hasManagedCredentials returns true', async () => {
		// Restore original autoconfigure so the real implementation runs
		FoundryModelProvider.autoconfigure = originalFoundryAutoconfigure;
		sinon.stub(pwbModule, 'hasManagedCredentials').returns(true);
		sinon.stub(pwbModule, 'autoconfigureWithManagedCredentials').resolves({
			configured: true,
			message: 'Foundry managed credentials',
		});

		const result = await FoundryModelProvider.autoconfigure();
		assert.strictEqual(result.configured, true);
		assert.strictEqual(result.message, 'Foundry managed credentials');
	});

	test('Existing providers (AWS/Snowflake) still work after Foundry addition', async () => {
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
		FoundryModelProvider.autoconfigure = async () => ({
			configured: false,
		});

		const configs = await createAutomaticModelConfigs();

		const awsConfig = configs.find(c => c.provider === 'amazon-bedrock');
		assert.ok(awsConfig, 'AWS config should still be created');

		const snowflakeConfig = configs.find(c => c.provider === 'snowflake-cortex');
		assert.ok(snowflakeConfig, 'Snowflake config should still be created');
	});
});
