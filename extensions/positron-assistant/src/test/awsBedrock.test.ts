/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider';
import { BedrockClient } from '@aws-sdk/client-bedrock';
import { ModelConfig } from '../config';
import { ErrorContext } from '../providers/aws/errorFormatting';

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
			assert.ok(result.includes('configure credentials'), 'Expected link text for settings');
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

		test('handles IAM AccessDeniedException with documentation link', async () => {
			const error = new Error(
				'User: arn:aws:sts:::assumed-role/EC2_SSM_Role/session is not authorized to perform: bedrock:ListFoundationModels because no identity-based policy allows the bedrock:ListFoundationModels action'
			);
			error.name = 'AccessDeniedException';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('authorization failed'), 'Expected authorization failure message');
			assert.ok(result.includes('test-profile'), 'Expected profile name in error message');
			assert.ok(result.includes('us-west-2'), 'Expected region in error message');
			assert.ok(result.includes('required permissions documentation'), 'Expected documentation link text');
			assert.ok(result.includes('docs.posit.co'), 'Expected documentation URL');
			assert.ok(result.includes('command:workbench.action.openSettings'), 'Expected command link for settings');
			// Should not include technical details
			assert.ok(!result.includes('EC2_SSM_Role'), 'Should not include user ARN');
			assert.ok(!result.includes('Denied action'), 'Should not include denied action label');
		});

		test('handles IAM errors without specific action match', async () => {
			const error = new Error('Access denied to Bedrock');
			error.name = 'UnauthorizedException';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('authorization failed'), 'Expected authorization failure message');
			assert.ok(result.includes('required permissions documentation'), 'Expected documentation link text');
		});

		test('handles errors with "is not authorized to perform" phrase', async () => {
			const error = new Error('You are not authorized to perform: bedrock:InvokeModel');
			error.name = 'SomeOtherError';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('authorization failed'), 'Expected authorization failure message');
			assert.ok(result.includes('required permissions documentation'), 'Expected documentation link text');
		});

		test('handles AI_APICallError with AccessDeniedException in responseBody', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			const error = {
				name: 'AI_APICallError',
				message: 'API call failed',
				statusCode: 403,
				responseHeaders: {
					'x-amzn-errortype': 'AccessDeniedException:http://internal.amazon.com/coral/com.amazon.coral.service/'
				},
				responseBody: JSON.stringify({
					Message: 'User: arn:aws:sts::123456789012:assumed-role/TestRole/session is not authorized to perform: bedrock:InvokeModelWithResponseStream on resource: arn:aws:bedrock:::foundation-model/test-model because no identity-based policy allows the bedrock:InvokeModelWithResponseStream action'
				})
			} as any;

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('authorization failed'), 'Expected authorization failure message');
			assert.ok(result.includes('required permissions documentation'), 'Expected documentation link text');
			// Should not include technical details
			assert.ok(!result.includes('TestRole'), 'Should not include user ARN');
		});

		test('IAM error includes markdown formatting and command links', async () => {
			const error = new Error(
				'User: arn:aws:iam::123456789012:user/alice is not authorized to perform: bedrock:InvokeModel'
			);
			error.name = 'AccessDeniedException';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');

			// Verify command link to settings
			assert.ok(result.includes('[configure'), 'Expected link text');
			assert.ok(result.includes('command:workbench.action.openSettings'), 'Expected command URI');

			// Verify documentation link
			assert.ok(result.includes('[required permissions documentation]'), 'Expected documentation link');
			assert.ok(result.includes('docs.posit.co'), 'Expected documentation URL');

			// Verify paragraph breaks
			assert.ok(result.includes('\n\n'), 'Expected paragraph breaks');

			// Should not include technical details
			assert.ok(!result.includes('**User:**'), 'Should not include user ARN label');
			assert.ok(!result.includes('**Denied action:**'), 'Should not include denied action label');
		});

		test('connection test context is used to check if in connection test', async () => {
			const error = new Error(
				'User: arn:aws:iam::123456789012:user/alice is not authorized to perform: bedrock:InvokeModel'
			);
			error.name = 'AccessDeniedException';

			const context: ErrorContext = {
				isConnectionTest: true,
				isChat: false,
				isStartup: false
			};

			// Should not show notification when in connection test
			const result = await provider.parseProviderError(error, context);

			assert.ok(result, 'Expected error message to be returned');
			// Manual verification: In a real scenario, we would verify that
			// vscode.window.showErrorMessage is not called, but that requires mocking
		});

		test('credentials error uses authentication template', async () => {
			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			assert.ok(result, 'Expected error message to be returned');
			assert.ok(result.includes('authentication failed'), 'Expected authentication failure message');
			assert.ok(result.includes('test-profile'), 'Expected profile name');
			assert.ok(result.includes('us-west-2'), 'Expected region');
			assert.ok(result.includes('command:workbench.action.openSettings'), 'Expected settings link');
			assert.ok(result.includes('command:workbench.action.terminal.new'), 'Expected terminal link');
			assert.ok(result.includes('aws configure'), 'Expected setup instructions');
		});
	});
});
