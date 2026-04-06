/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import * as positron from 'positron';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider';
import { BedrockClient } from '@aws-sdk/client-bedrock';
import { ModelConfig } from '../configTypes';
import { ErrorContext } from '../providers/base/errorContext';
import { AttributedAwsCredentialIdentity } from '@aws-sdk/types';

describe('AWSModelProvider', () => {
	describe('deriveInferenceProfileRegion', () => {
		it('returns "us" for us-east-1', () => {
			const result = AWSModelProvider.deriveInferenceProfileRegion('us-east-1');
			expect(result).toBe('us');
		});

		it('returns "apac" for ap-northeast-1', () => {
			const result = AWSModelProvider.deriveInferenceProfileRegion('ap-northeast-1');
			expect(result).toBe('apac');
		});
	});

	describe('parseProviderError', () => {
		let provider: AWSModelProvider;

		beforeEach(() => {
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

		it('returns undefined for non-Error objects', async () => {
			const result = await provider.parseProviderError('not an error');
			expect(result).toBe(undefined);
		});

		it('returns undefined for errors without a message', async () => {
			const error = new Error();
			error.name = 'TestError';
			error.message = '';
			const result = await provider.parseProviderError(error);
			expect(result).toBe(undefined);
		});

		it('handles generic CredentialsProviderError with profile and region context', async () => {
			// Set SSO credential source to test SSO-specific guidance
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_SSO: 's' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('test-profile')).toBeTruthy();
			expect(result!.includes('us-west-2')).toBeTruthy();
			expect(result!.includes('command:workbench.action.openSettings')).toBeTruthy();
			expect(result!.includes('configure')).toBeTruthy();
			expect(result!.includes('aws sso login')).toBeTruthy();
		});

		it('includes default profile when profile is not set', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			provider.bedrockClient = {
				config: {
					profile: undefined,
					region: 'us-west-2'
				}
			} as any;

			// Use shared credentials source so the 'default' profile fallback in
			// authenticationError's CREDENTIALS_PROFILE branch is exercised
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_PROFILE: 'n' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('default')).toBeTruthy();
		});

		it('handles region as async function', async () => {
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

			expect(result).toBeTruthy();
			expect(result!.includes('eu-central-1')).toBeTruthy();
		});

		it('uses default region when region is not set', async () => {
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

			expect(result).toBeTruthy();
			expect(result!.includes('us-east-1')).toBeTruthy();
		});

		it('wraps non-CredentialsProviderError messages with "Amazon Bedrock error" prefix', async () => {
			const error = new Error('Model not found');
			error.name = 'ModelNotFoundException';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('Amazon Bedrock error')).toBeTruthy();
			expect(result!.includes('Model not found')).toBeTruthy();
		});

		it('returns generic Bedrock error for unrecognized error names', async () => {
			// An error with an unrecognized name and no special status code falls through
			// to the generic "Amazon Bedrock error" handler.
			// eslint-disable-next-line local/code-no-any-casts
			const error = new Error('Unauthorized') as any;
			error.name = 'UnauthorizedError';
			error.statusCode = 401;

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('Amazon Bedrock error')).toBeTruthy();
			expect(result!.includes('Unauthorized')).toBeTruthy();
		});

		it('handles IAM AccessDeniedException with documentation link', async () => {
			const error = new Error(
				'User: arn:aws:sts:::assumed-role/EC2_SSM_Role/session is not authorized to perform: bedrock:ListFoundationModels because no identity-based policy allows the bedrock:ListFoundationModels action'
			);
			error.name = 'AccessDeniedException';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('authorization failed')).toBeTruthy();
			expect(result!.includes('test-profile')).toBeTruthy();
			expect(result!.includes('us-west-2')).toBeTruthy();
			expect(result!.includes('required permissions documentation')).toBeTruthy();
			expect(result!.includes('positron.posit.co')).toBeTruthy();
			expect(result!.includes('command:workbench.action.openSettings')).toBeTruthy();
			// Should not include technical details
			expect(result!.includes('EC2_SSM_Role')).toBe(false);
			expect(result!.includes('Denied action')).toBe(false);
		});

		it('handles IAM errors without specific action match', async () => {
			const error = new Error('Access denied to Bedrock');
			error.name = 'UnauthorizedException';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('authorization failed')).toBeTruthy();
			expect(result!.includes('required permissions documentation')).toBeTruthy();
		});

		it('handles errors with "is not authorized to perform" phrase', async () => {
			const error = new Error('You are not authorized to perform: bedrock:InvokeModel');
			error.name = 'SomeOtherError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('authorization failed')).toBeTruthy();
			expect(result!.includes('required permissions documentation')).toBeTruthy();
		});

		it('returns undefined for non-Error plain objects (AI_APICallError duck type)', async () => {
			// Plain objects that are not real ai.APICallError instances and not Error instances
			// are not handled by the AWS provider and return undefined.
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

			expect(result).toBe(undefined);
		});

		it('IAM error includes markdown formatting and command links', async () => {
			const error = new Error(
				'User: arn:aws:iam::123456789012:user/alice is not authorized to perform: bedrock:InvokeModel'
			);
			error.name = 'AccessDeniedException';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();

			// Verify command link to settings
			expect(result!.includes('[configure')).toBeTruthy();
			expect(result!.includes('command:workbench.action.openSettings')).toBeTruthy();

			// Verify documentation link
			expect(result!.includes('[required permissions documentation]')).toBeTruthy();
			expect(result!.includes('positron.posit.co')).toBeTruthy();

			// Verify paragraph breaks
			expect(result!.includes('\n\n')).toBeTruthy();

			// Should not include technical details
			expect(result!.includes('**User:**')).toBe(false);
			expect(result!.includes('**Denied action:**')).toBe(false);
		});

		it('connection test context is used to check if in connection test', async () => {
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

			expect(result).toBeTruthy();
			// Manual verification: In a real scenario, we would verify that
			// vscode.window.showErrorMessage is not called, but that requires mocking
		});

		it('credentials error uses authentication template', async () => {
			// Set SSO credential source to test SSO-specific guidance
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_SSO: 's' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('authentication failed')).toBeTruthy();
			expect(result!.includes('test-profile')).toBeTruthy();
			expect(result!.includes('us-west-2')).toBeTruthy();
			expect(result!.includes('command:workbench.action.openSettings')).toBeTruthy();
			expect(result!.includes('command:workbench.action.terminal.new')).toBeTruthy();
			expect(result!.includes('aws sso login')).toBeTruthy();
		});

		it('includes credential type in error messages when available', async () => {
			// Set a credential source on the provider
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_SSO: 's' });

			const error = new Error('Access denied');
			error.name = 'AccessDeniedException';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('SSO')).toBeTruthy();
		});

		it('includes credential-specific guidance for environment variables', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_ENV_VARS: 'g' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('environment variables')).toBeTruthy();
			expect(result!.includes('AWS_ACCESS_KEY_ID')).toBeTruthy();
			expect(result!.includes('AWS_SECRET_ACCESS_KEY')).toBeTruthy();
			// Should not suggest SSO login for environment variables
			expect(result!.includes('aws sso login')).toBe(false);
		});

		it('includes credential-specific guidance for shared credentials file', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_PROFILE: 'n' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('shared credentials file')).toBeTruthy();
			expect(result!.includes('~/.aws/credentials')).toBeTruthy();
			// Should not suggest SSO login for shared credentials file
			expect(result!.includes('aws sso login')).toBe(false);
		});

		it('includes credential-specific guidance for EC2 instance metadata', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_IMDS: '0' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('EC2 instance metadata')).toBeTruthy();
			expect(result!.includes('IAM role')).toBeTruthy();
		});

		it('includes credential-specific guidance for credential process', async () => {
			// eslint-disable-next-line local/code-no-any-casts
			(provider as any)._credentialSourcePromise = Promise.resolve({ CREDENTIALS_PROCESS: 'w' });

			const error = new Error('Could not load credentials');
			error.name = 'CredentialsProviderError';

			const result = await provider.parseProviderError(error);

			expect(result).toBeTruthy();
			expect(result!.includes('credential process')).toBeTruthy();
			expect(result!.includes('~/.aws/config')).toBeTruthy();
		});
	});

	describe('getCredentialSource', () => {
		it('detects environment variable credentials', async () => {
			const mockProvider = async (): Promise<AttributedAwsCredentialIdentity> => ({
				accessKeyId: 'test',
				secretAccessKey: 'test',
				$source: { CREDENTIALS_ENV_VARS: 'g' }
			});

			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			const provider = new AWSModelProvider(config);
			// eslint-disable-next-line local/code-no-any-casts
			const result = await (provider as any).getCredentialSource(mockProvider);

			expect(result).toBeTruthy();
			expect(result.CREDENTIALS_ENV_VARS).toBe('g');
		});

		it('detects SSO credentials', async () => {
			const mockProvider = async (): Promise<AttributedAwsCredentialIdentity> => ({
				accessKeyId: 'test',
				secretAccessKey: 'test',
				$source: { CREDENTIALS_SSO: 's' }
			});

			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			const provider = new AWSModelProvider(config);
			// eslint-disable-next-line local/code-no-any-casts
			const result = await (provider as any).getCredentialSource(mockProvider);

			expect(result).toBeTruthy();
			expect(result.CREDENTIALS_SSO).toBe('s');
		});

		it('detects EC2 instance metadata credentials', async () => {
			const mockProvider = async (): Promise<AttributedAwsCredentialIdentity> => ({
				accessKeyId: 'test',
				secretAccessKey: 'test',
				$source: { CREDENTIALS_IMDS: '0' }
			});

			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			const provider = new AWSModelProvider(config);
			// eslint-disable-next-line local/code-no-any-casts
			const result = await (provider as any).getCredentialSource(mockProvider);

			expect(result).toBeTruthy();
			expect(result.CREDENTIALS_IMDS).toBe('0');
		});

		it('detects shared credentials file', async () => {
			const mockProvider = async (): Promise<AttributedAwsCredentialIdentity> => ({
				accessKeyId: 'test',
				secretAccessKey: 'test',
				$source: { CREDENTIALS_PROFILE: 'n' }
			});

			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			const provider = new AWSModelProvider(config);
			// eslint-disable-next-line local/code-no-any-casts
			const result = await (provider as any).getCredentialSource(mockProvider);

			expect(result).toBeTruthy();
			expect(result.CREDENTIALS_PROFILE).toBe('n');
		});

		it('returns undefined when $source is missing', async () => {
			const mockProvider = async (): Promise<AttributedAwsCredentialIdentity> => ({
				accessKeyId: 'test',
				secretAccessKey: 'test'
			});

			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			const provider = new AWSModelProvider(config);
			// eslint-disable-next-line local/code-no-any-casts
			const result = await (provider as any).getCredentialSource(mockProvider);

			expect(result).toBe(undefined);
		});

		it('returns undefined when credential resolution fails', async () => {
			const mockProvider = async (): Promise<AttributedAwsCredentialIdentity> => {
				throw new Error('Credential resolution failed');
			};

			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};

			const provider = new AWSModelProvider(config);
			// eslint-disable-next-line local/code-no-any-casts
			const result = await (provider as any).getCredentialSource(mockProvider);

			expect(result).toBe(undefined);
		});
	});

	describe('provider routing', () => {
		let provider: AWSModelProvider;

		beforeEach(() => {
			const config: ModelConfig = {
				id: 'test-bedrock-model',
				name: 'Test Provider',
				provider: 'amazon-bedrock',
				model: 'test-model',
				apiKey: 'test-key',
				type: positron.PositronLanguageModelType.Chat
			};
			provider = new AWSModelProvider(config);
		});

		it('routes Anthropic models to the Bedrock Anthropic provider', () => {
			// eslint-disable-next-line local/code-no-any-casts
			const model = (provider as any).aiProvider('us.anthropic.claude-sonnet-4-20250514-v1:0');
			expect(model.provider).toBe('bedrock.anthropic.messages');
		});

		it('routes non-Anthropic models to the generic Bedrock provider', () => {
			// eslint-disable-next-line local/code-no-any-casts
			const model = (provider as any).aiProvider('us.meta.llama3-1-70b-instruct-v1:0');
			expect(model.provider).toBe('amazon-bedrock');
		});
	});
});
