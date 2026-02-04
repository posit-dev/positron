/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as ai from 'ai';
import Anthropic from '@anthropic-ai/sdk';
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream.js';
import { PositModelProvider } from '../providers/posit/positProvider';
import { ModelConfig } from '../config';
import { mock } from './utils.js';

suite('PositModelProvider', () => {
	let model: PositModelProvider;
	let mockModelInfo: vscode.LanguageModelChatInformation;
	let progress: { report: sinon.SinonStub };
	let cancellationToken: vscode.CancellationToken;

	setup(() => {
		// Mock workspace configuration to provide OAuth parameters
		const mockConfig = {
			get: (key: string, defaultValue?: any) => {
				const configValues: Record<string, any> = {
					'authHost': 'https://auth.test.posit.cloud',
					'scope': 'openid profile email',
					'clientId': 'test-client-id',
					'baseUrl': 'https://api.test.posit.cloud',
					'useAnthropicSdk': true // Native SDK by default
				};
				return configValues[key] ?? defaultValue;
			}
		};

		sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
			if (section === 'positron.assistant.positai' || section === 'positron.assistant') {
				return mockConfig as any;
			}
			return { get: () => undefined } as any;
		});

		// Create a mock configuration
		const config: ModelConfig = {
			id: 'test-model',
			name: 'Test Model',
			provider: 'posit-ai',
			model: 'claude-sonnet-4-5-20250929',
			apiKey: '', // Not used for OAuth-based Posit AI
			type: positron.PositronLanguageModelType.Chat
		};

		// Create an instance of the PositModelProvider
		model = new PositModelProvider(config, undefined);

		// Create mock model info for provideLanguageModelChatResponse
		mockModelInfo = {
			id: 'claude-sonnet-4-5-20250929',
			name: 'Claude Sonnet 4.5',
			family: 'posit-ai',
			version: '',
			maxInputTokens: 200000,
			maxOutputTokens: 8192,
			capabilities: {},
		};

		// Create mock progress
		progress = {
			report: sinon.stub()
		};

		// Create a cancellation token
		const cancellationTokenSource = new vscode.CancellationTokenSource();
		cancellationToken = cancellationTokenSource.token;
	});

	teardown(() => {
		sinon.restore();
	});

	suite('Rate limit error handling (Vercel SDK path)', () => {
		test('throws error with retry-after when rate limited with header', () => {
			// Create an APICallError with 429 status and retry-after header
			const rateLimitError = new ai.APICallError({
				message: 'Rate limit exceeded',
				url: 'https://api.posit.cloud/anthropic/v1/messages',
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
				url: 'https://api.posit.cloud/anthropic/v1/messages',
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
				url: 'https://api.posit.cloud/anthropic/v1/messages',
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

	suite('Rate limit error handling (Native SDK path)', () => {
		test('throws error with retry-after when rate limited with header', async () => {
			// Create headers with retry-after
			const headers = new Headers();
			headers.set('retry-after', '45');

			// Create an APIError with 429 status and retry-after header
			const rateLimitError = new Anthropic.APIError(
				429,
				{ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
				'Rate limit exceeded',
				headers
			);

			// Configure mock client to reject with rate limit error
			const mockStream = mock<MessageStream>({
				on: () => mock<MessageStream>({}),
				abort: () => { },
				done: () => Promise.reject(rateLimitError),
				finalMessage: () => Promise.resolve(mock<Anthropic.Message>({})),
				request_id: 'test-request-id'
			});

			// Access the private _anthropicClient and mock it
			(model as any)._anthropicClient = {
				messages: {
					stream: sinon.stub().returns(mockStream)
				}
			};

			// Stub getAccessToken to avoid actual OAuth calls
			sinon.stub(model, 'getAccessToken').resolves('mock-token');

			const messages = [vscode.LanguageModelChatMessage.User('Test message')];

			await assert.rejects(
				() => model.provideLanguageModelChatResponse(
					mockModelInfo,
					messages,
					{ requestInitiator: 'test', toolMode: vscode.LanguageModelChatToolMode.Auto },
					progress as any,
					cancellationToken
				),
				(error: Error) => {
					assert.ok(error.message.includes('Rate limit exceeded'), 'Error message should mention rate limit');
					assert.ok(error.message.includes('retry after 45 seconds'), 'Error message should include retry-after value');
					return true;
				}
			);
		});

		test('throws error without retry-after when rate limited without header', async () => {
			// Create empty headers (no retry-after)
			const headers = new Headers();

			// Create an APIError with 429 status but no retry-after header
			const rateLimitError = new Anthropic.APIError(
				429,
				{ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
				'Rate limit exceeded',
				headers
			);

			// Configure mock client to reject with rate limit error
			const mockStream = mock<MessageStream>({
				on: () => mock<MessageStream>({}),
				abort: () => { },
				done: () => Promise.reject(rateLimitError),
				finalMessage: () => Promise.resolve(mock<Anthropic.Message>({})),
				request_id: 'test-request-id'
			});

			// Access the private _anthropicClient and mock it
			(model as any)._anthropicClient = {
				messages: {
					stream: sinon.stub().returns(mockStream)
				}
			};

			// Stub getAccessToken to avoid actual OAuth calls
			sinon.stub(model, 'getAccessToken').resolves('mock-token');

			const messages = [vscode.LanguageModelChatMessage.User('Test message')];

			await assert.rejects(
				() => model.provideLanguageModelChatResponse(
					mockModelInfo,
					messages,
					{ requestInitiator: 'test', toolMode: vscode.LanguageModelChatToolMode.Auto },
					progress as any,
					cancellationToken
				),
				(error: Error) => {
					assert.ok(error.message.includes('Rate limit exceeded'), 'Error message should mention rate limit');
					assert.ok(error.message.includes('try again later'), 'Error message should suggest trying later');
					assert.ok(!error.message.includes('retry after'), 'Error message should not include retry-after');
					return true;
				}
			);
		});

		test('re-throws non-rate-limit APIError unchanged', async () => {
			// Create an APIError with non-429 status (e.g., 500)
			const serverError = new Anthropic.APIError(
				500,
				{ error: { type: 'server_error', message: 'Internal server error' } },
				'Internal server error',
				new Headers()
			);

			// Configure mock client to reject with server error
			const mockStream = mock<MessageStream>({
				on: () => mock<MessageStream>({}),
				abort: () => { },
				done: () => Promise.reject(serverError),
				finalMessage: () => Promise.resolve(mock<Anthropic.Message>({})),
				request_id: 'test-request-id'
			});

			// Access the private _anthropicClient and mock it
			(model as any)._anthropicClient = {
				messages: {
					stream: sinon.stub().returns(mockStream)
				}
			};

			// Stub getAccessToken to avoid actual OAuth calls
			sinon.stub(model, 'getAccessToken').resolves('mock-token');

			const messages = [vscode.LanguageModelChatMessage.User('Test message')];

			await assert.rejects(
				() => model.provideLanguageModelChatResponse(
					mockModelInfo,
					messages,
					{ requestInitiator: 'test', toolMode: vscode.LanguageModelChatToolMode.Auto },
					progress as any,
					cancellationToken
				),
				(error: Error) => {
					// The error should be re-thrown as-is (same instance)
					assert.strictEqual(error, serverError, 'Error should be the same instance');
					return true;
				}
			);
		});
	});
});
