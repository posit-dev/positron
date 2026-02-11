/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider';
import { BedrockClient } from '@aws-sdk/client-bedrock';
import { ModelConfig } from '../config';

suite('AWSModelProvider', () => {
	suite('deriveInferenceProfileRegion', () => {
		test('returns "us" for us-east-1', () => {
			const result = AWSModelProvider.deriveInferenceProfileRegion('us-east-1');
			assert.strictEqual(result, 'us');
		});

		test('returns "apac" for ap-northeast-1', () => {
			const result = AWSModelProvider.deriveInferenceProfileRegion('ap-northeast-1');
			assert.strictEqual(result, 'apac');
		});
	});

	suite('parseProviderError', () => {
		let provider: AWSModelProvider;

		setup(() => {
			// Create a minimal provider instance for testing
			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			provider = new AWSModelProvider(config);

			// Mock the bedrockClient with test profile and region
			provider.bedrockClient = {
				config: {
					profile: 'test-profile',
					region: 'us-west-2'
				}
			} as BedrockClient;
		});

		test('returns undefined for non-Error objects', async () => {
			const result = await provider.parseProviderError('not an error');
			assert.strictEqual(result, undefined);
		});

		test('returns undefined for errors without a message', async () => {
			const error = new Error();
			error.name = 'TestError';
			error.message = '';
			const result = await provider.parseProviderError(error);
			assert.strictEqual(result, undefined);
		});

		test('handles generic CredentialsProviderError with profile and region context', async () => {
			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('test-profile'), 'Expected profile name in error message');
			assert.ok(result.includes('us-west-2'), 'Expected region in error message');
			assert.ok(result.includes('command:workbench.action.openSettings'), 'Expected command link for settings');
			assert.ok(result.includes('configure the AWS profile and region'), 'Expected link text for settings');
			assert.ok(result.includes('aws configure'), 'Expected setup instructions in error message');
			assert.ok(result.includes('aws sso login'), 'Expected SSO login instructions in error message');
		});

		test('includes default profile when profile is not set', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			provider.bedrockClient = {
				config: {
					profile: undefined,
					region: 'us-west-2'
				}
			} as any;

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('default'), 'Expected "default" profile in error message');
		});

		test('handles region as async function', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			provider.bedrockClient = {
				config: {
					profile: 'test-profile',
					region: async () => 'eu-central-1'
				}
			} as any;

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('eu-central-1'), 'Expected async region in error message');
		});

		test('uses default region when region is not set', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			provider.bedrockClient = {
				config: {
					profile: 'test-profile',
					region: undefined
				}
			} as any;

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('us-east-1'), 'Expected default region in error message');
		});

		test('wraps non-CredentialsProviderError messages with "Amazon Bedrock error" prefix', async () => {
			const error = new Error('Model not found');
			error.name = 'ModelNotFoundException';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('Amazon Bedrock error'), 'Expected "Amazon Bedrock error" prefix');
			assert.ok(result.includes('Model not found'), 'Expected original error message');
		});

		test('delegates to base class for authorization errors', async () => {
			// Create an error that looks like an authorization error
			// eslint-disable-next-line local/code-no-any-casts
			const error = new Error('Unauthorized') as any;
			error.name = 'UnauthorizedError';
			error.statusCode = 401;

			// The base class should handle this and throw an AuthenticationError
			try {
				await provider.parseProviderError(error);
				assert.fail('Expected error to be thrown');
			} catch (err) {
				// We expect the base class to throw an authentication error
				assert.ok(err, 'Expected error to be thrown by base class');
			}
		});
	});
});
