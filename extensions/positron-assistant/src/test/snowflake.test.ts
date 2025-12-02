/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	isValidSnowflakeAccount,
	detectSnowflakeCredentials,
	extractSnowflakeError,
	getSnowflakeDefaultBaseUrl
} from '../snowflakeAuth.js';
import { createOpenAICompatibleFetch } from '../openai-fetch-utils.js';

suite('Snowflake Provider', () => {

	teardown(() => {
		sinon.restore();
	});

	suite('Account Validation', () => {
		test('isValidSnowflakeAccount accepts valid account formats', () => {
			// Standard org-account format
			assert.strictEqual(isValidSnowflakeAccount('myorg-myaccount'), true);
			assert.strictEqual(isValidSnowflakeAccount('posit_inc-test_account'), true);

			// Legacy account format
			assert.strictEqual(isValidSnowflakeAccount('abc12345'), true);
			assert.strictEqual(isValidSnowflakeAccount('account-123'), true);

			// Mixed case and special characters
			assert.strictEqual(isValidSnowflakeAccount('MyOrg-MyAccount'), true);
		});

		test('isValidSnowflakeAccount rejects invalid account formats', () => {
			// Empty or non-string inputs
			assert.strictEqual(isValidSnowflakeAccount(''), false);
			// Testing with invalid types that could occur at runtime
			assert.strictEqual(isValidSnowflakeAccount(null as unknown as string), false);
			assert.strictEqual(isValidSnowflakeAccount(undefined as unknown as string), false);
			assert.strictEqual(isValidSnowflakeAccount(123 as unknown as string), false);

			// Invalid characters
			assert.strictEqual(isValidSnowflakeAccount('account@domain'), false);
			assert.strictEqual(isValidSnowflakeAccount('account with spaces'), false);
			assert.strictEqual(isValidSnowflakeAccount('account.domain.com'), false);

			// Multiple dots (should only have one for org-account format)
			assert.strictEqual(isValidSnowflakeAccount('org.sub.account'), false);
		});
	});

	suite('Default Base URL', () => {
		let mockWorkspaceConfig: sinon.SinonStub;
		let getConfigurationStub: sinon.SinonStub;
		let processEnvStub: sinon.SinonStub;

		setup(() => {
			mockWorkspaceConfig = sinon.stub();
			const mockConfig: vscode.WorkspaceConfiguration = {
				get: mockWorkspaceConfig,
				has: sinon.stub(),
				inspect: sinon.stub(),
				update: sinon.stub()
			};
			getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);

			// Stub process.env
			processEnvStub = sinon.stub(process, 'env').value({});
		});

		teardown(() => {
			getConfigurationStub.restore();
			processEnvStub.restore();
		});

		test('getSnowflakeDefaultBaseUrl uses account from configuration', () => {
			mockWorkspaceConfig.withArgs('snowflake', {}).returns({ SNOWFLAKE_ACCOUNT: 'config-account' });

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://config-account.snowflakecomputing.com/api/v2/cortex/v1');
		});

		test('getSnowflakeDefaultBaseUrl uses account from environment', () => {
			mockWorkspaceConfig.withArgs('snowflake', {}).returns({});
			processEnvStub.value({ SNOWFLAKE_ACCOUNT: 'env-account' });

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://env-account.snowflakecomputing.com/api/v2/cortex/v1');
		});

		test('getSnowflakeDefaultBaseUrl falls back to placeholder when no account available', () => {
			mockWorkspaceConfig.withArgs('snowflake', {}).returns({});

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://<account_identifier>.snowflakecomputing.com/api/v2/cortex/v1');
		});

		test('getSnowflakeDefaultBaseUrl falls back to placeholder for invalid account', () => {
			mockWorkspaceConfig.withArgs('snowflake', {}).returns({ SNOWFLAKE_ACCOUNT: 'invalid@account' });

			const url = getSnowflakeDefaultBaseUrl();
			assert.strictEqual(url, 'https://<account_identifier>.snowflakecomputing.com/api/v2/cortex/v1');
		});
	});

	suite('Credential Detection', () => {
		let mockWorkspaceConfig: sinon.SinonStub;
		let getConfigurationStub: sinon.SinonStub;
		let processEnvStub: sinon.SinonStub;

		setup(() => {
			mockWorkspaceConfig = sinon.stub();
			const mockConfig: vscode.WorkspaceConfiguration = {
				get: mockWorkspaceConfig,
				has: sinon.stub(),
				inspect: sinon.stub(),
				update: sinon.stub()
			};
			getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);

			// Stub process.env
			processEnvStub = sinon.stub(process, 'env').value({});
		});

		teardown(() => {
			getConfigurationStub.restore();
			processEnvStub.restore();
		});

		test('detectSnowflakeCredentials returns undefined when SNOWFLAKE_HOME not set', async () => {
			mockWorkspaceConfig.withArgs('snowflake', {}).returns({});

			const result = await detectSnowflakeCredentials();
			assert.strictEqual(result, undefined);
		});

		// Note: Tests for actual file parsing are skipped due to filesystem stubbing limitations
		// The core credential extraction logic is covered by integration tests
	});

	suite('Error Message Enhancement', () => {
		test('extractSnowflakeError identifies cross-region errors', () => {
			const crossRegionError = {
				statusCode: 404,
				message: 'Model not available in the current region'
			};

			const result = extractSnowflakeError(crossRegionError);

			assert.ok(result, 'Should return enhanced error message');
			assert.ok(result.includes('Snowflake Cross-Region Issue'), 'Should identify as cross-region issue');
			assert.ok(result.includes('Contact your Snowflake administrator'), 'Should include admin contact guidance');
			assert.ok(result.includes('Response Status: 404'), 'Should include status code');
		});

		test('extractSnowflakeError identifies network policy errors', () => {
			const networkPolicyError = {
				statusCode: 403,
				message: 'Network policy is required for AI model access'
			};

			const result = extractSnowflakeError(networkPolicyError);

			assert.ok(result, 'Should return enhanced error message');
			assert.ok(result.includes('Snowflake Network Policy Issue'), 'Should identify as network policy issue');
			assert.ok(result.includes('Contact your Snowflake administrator'), 'Should include admin contact guidance');
			assert.ok(result.includes('Response Status: 403'), 'Should include status code');
		});

		test('extractSnowflakeError handles combined error types', () => {
			const combinedError = {
				statusCode: 403,
				message: 'Cross-region access blocked by network policy'
			};

			const result = extractSnowflakeError(combinedError);

			assert.ok(result, 'Should return enhanced error message');
			assert.ok(result.includes('Snowflake Configuration Issue'), 'Should identify as general config issue');
			assert.ok(result.includes('both network policies and cross-region settings'), 'Should mention both issues');
		});

		test('extractSnowflakeError returns undefined for non-Snowflake errors', () => {
			const genericError = {
				statusCode: 500,
				message: 'Internal server error'
			};

			const result = extractSnowflakeError(genericError);
			assert.strictEqual(result, undefined, 'Should not enhance non-Snowflake-specific errors');
		});
	});

	suite('OpenAI Compatible Fetch - Snowflake Streaming Fix', () => {
		let fetchStub: sinon.SinonStub;

		setup(() => {
			fetchStub = sinon.stub(global, 'fetch');
		});

		teardown(() => {
			fetchStub.restore();
		});

		test('transforms empty role fields in streaming response', async () => {
			const mockStreamingData = `data: {"choices":[{"delta":{"content":"Hi","role":"","tool_calls":null},"index":0}],"id":"test-id","model":"openai-gpt-5","object":"chat.completion.chunk"}

data: [DONE]

`;

			const mockResponse = new Response(mockStreamingData, {
				status: 200,
				headers: {
					'content-type': 'text/event-stream'
				}
			});

			fetchStub.resolves(mockResponse);

			const customFetch = createOpenAICompatibleFetch('Snowflake Cortex');
			const response = await customFetch('https://test.com/api', {
				method: 'POST',
				body: JSON.stringify({})
			});

			assert.strictEqual(response.status, 200);

			// Read the transformed stream
			const reader = response.body?.getReader();
			const chunks: string[] = [];
			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }
					chunks.push(new TextDecoder().decode(value));
				}
			}

			const transformedText = chunks.join('');

			// Verify that empty role field was transformed to "assistant"
			assert.ok(transformedText.includes('"role":"assistant"'), 'Empty role should be transformed to "assistant"');
			assert.ok(!transformedText.includes('"role":""'), 'Should not contain empty role field');
		});
	});
});
