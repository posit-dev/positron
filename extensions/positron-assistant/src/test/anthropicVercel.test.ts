/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { AnthropicAIModelProvider } from '../providers/anthropic/anthropicVercelProvider';
import { ModelConfig } from '../config';
import {
	createVercelRateLimitError,
	createVercelServerError,
	assertRateLimitErrorWithRetry,
	assertRateLimitErrorWithoutRetry
} from './utils.js';

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
			const rateLimitError = createVercelRateLimitError('30');

			assert.throws(
				() => (model as any).handleStreamError(rateLimitError),
				(error: Error) => {
					assertRateLimitErrorWithRetry(error, '30');
					return true;
				}
			);
		});

		test('throws error without retry-after when rate limited without header', () => {
			const rateLimitError = createVercelRateLimitError();

			assert.throws(
				() => (model as any).handleStreamError(rateLimitError),
				(error: Error) => {
					assertRateLimitErrorWithoutRetry(error);
					return true;
				}
			);
		});

		test('re-throws non-rate-limit APICallError unchanged', () => {
			const serverError = createVercelServerError(500, 'Internal server error');

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
