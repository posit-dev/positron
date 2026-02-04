/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as ai from 'ai';
import { AnthropicAIModelProvider } from '../providers/anthropic/anthropicVercelProvider';
import { ModelConfig } from '../config';

suite('AnthropicAIModelProvider (Vercel)', () => {
	let model: AnthropicAIModelProvider;

	setup(() => {
		// Create a mock configuration
		const config: ModelConfig = {
			id: 'test-model',
			name: 'Test Model',
			provider: 'anthropic-api',
			model: 'claude-test',
			apiKey: 'test-api-key',
			type: positron.PositronLanguageModelType.Chat
		};

		// Create an instance of the AnthropicAIModelProvider
		model = new AnthropicAIModelProvider(config, undefined);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('Rate limit error handling', () => {
		test('throws error with retry-after when rate limited with header', () => {
			// Create an APICallError with 429 status and retry-after header
			const rateLimitError = new ai.APICallError({
				message: 'Rate limit exceeded',
				url: 'https://api.anthropic.com/v1/messages',
				requestBodyValues: {},
				statusCode: 429,
				responseHeaders: { 'retry-after': '30' },
				responseBody: JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }),
				isRetryable: true,
			});

			assert.throws(
				() => (model as any).handleStreamError(rateLimitError),
				(error: Error) => {
					assert.ok(error.message.includes('Rate limit exceeded'), 'Error message should mention rate limit');
					assert.ok(error.message.includes('retry after 30 seconds'), 'Error message should include retry-after value');
					return true;
				}
			);
		});

		test('throws error without retry-after when rate limited without header', () => {
			// Create an APICallError with 429 status but no retry-after header
			const rateLimitError = new ai.APICallError({
				message: 'Rate limit exceeded',
				url: 'https://api.anthropic.com/v1/messages',
				requestBodyValues: {},
				statusCode: 429,
				responseHeaders: {},
				responseBody: JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }),
				isRetryable: true,
			});

			assert.throws(
				() => (model as any).handleStreamError(rateLimitError),
				(error: Error) => {
					assert.ok(error.message.includes('Rate limit exceeded'), 'Error message should mention rate limit');
					assert.ok(error.message.includes('try again later'), 'Error message should suggest trying later');
					assert.ok(!error.message.includes('retry after'), 'Error message should not include retry-after');
					return true;
				}
			);
		});

		test('re-throws non-rate-limit APICallError unchanged', () => {
			// Create an APICallError with non-429 status
			const serverError = new ai.APICallError({
				message: 'Internal server error',
				url: 'https://api.anthropic.com/v1/messages',
				requestBodyValues: {},
				statusCode: 500,
				responseHeaders: {},
				responseBody: JSON.stringify({ error: { type: 'server_error', message: 'Internal server error' } }),
				isRetryable: true,
			});

			assert.throws(
				() => (model as any).handleStreamError(serverError),
				(error: Error) => {
					// The error should be re-thrown as-is
					assert.strictEqual(error, serverError, 'Error should be the same instance');
					return true;
				}
			);
		});

		test('re-throws non-APICallError unchanged', () => {
			const genericError = new Error('Some other error');

			assert.throws(
				() => (model as any).handleStreamError(genericError),
				(error: Error) => {
					// The error should be re-thrown as-is
					assert.strictEqual(error, genericError, 'Error should be the same instance');
					assert.strictEqual(error.message, 'Some other error');
					return true;
				}
			);
		});
	});
});
