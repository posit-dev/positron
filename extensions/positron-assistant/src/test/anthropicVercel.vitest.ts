/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment node

import * as positron from 'positron';
import * as sinon from 'sinon';
import { AnthropicAIModelProvider } from '../providers/anthropic/anthropicVercelProvider';
import {
	createVercelRateLimitError,
	createVercelServerError,
	assertRateLimitErrorWithRetry,
	assertRateLimitErrorWithoutRetry
} from './utils.js';
import { ModelConfig } from '../configTypes.js';

describe('AnthropicAIModelProvider (Vercel)', () => {
	let model: AnthropicAIModelProvider;

	beforeEach(() => {
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

	afterEach(() => {
		sinon.restore();
	});

	describe('Rate limit error handling', () => {
		it('throws error with retry-after when rate limited with header', () => {
			const rateLimitError = createVercelRateLimitError('30');

			expect(() => (model as any).handleStreamError(rateLimitError)).toThrow();
			try {
				(model as any).handleStreamError(rateLimitError);
			} catch (error) {
				assertRateLimitErrorWithRetry(error as Error, '30');
			}
		});

		it('throws error without retry-after when rate limited without header', () => {
			const rateLimitError = createVercelRateLimitError();

			expect(() => (model as any).handleStreamError(rateLimitError)).toThrow();
			try {
				(model as any).handleStreamError(rateLimitError);
			} catch (error) {
				assertRateLimitErrorWithoutRetry(error as Error);
			}
		});

		it('re-throws non-rate-limit APICallError unchanged', () => {
			const serverError = createVercelServerError(500, 'Internal server error');

			expect(() => (model as any).handleStreamError(serverError)).toThrow();
			try {
				(model as any).handleStreamError(serverError);
			} catch (error) {
				// The error should be re-thrown as-is
				expect(error).toBe(serverError);
			}
		});

		it('re-throws non-APICallError unchanged', () => {
			const genericError = new Error('Some other error');

			expect(() => (model as any).handleStreamError(genericError)).toThrow();
			try {
				(model as any).handleStreamError(genericError);
			} catch (error) {
				// The error should be re-thrown as-is
				expect(error).toBe(genericError);
				expect((error as Error).message).toBe('Some other error');
			}
		});
	});
});
