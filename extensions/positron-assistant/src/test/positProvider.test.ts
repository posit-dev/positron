/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream.js';
import { PositModelProvider } from '../providers/posit/positProvider';
import { ModelConfig } from '../configTypes.js';
import {
	mock,
	createVercelRateLimitError,
	createVercelServerError,
	createNativeRateLimitError,
	assertRateLimitErrorWithRetry,
	assertRateLimitErrorWithoutRetry
} from './utils.js';

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
					'authHost': 'https://auth.test.localhost',
					'scope': 'openid profile email',
					'clientId': 'test-client-id',
					'baseUrl': 'https://api.test.localhost',
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
			const rateLimitError = createVercelRateLimitError('30', 'https://api.localhost/anthropic/v1/messages');

			assert.throws(
				() => (model as any).handleStreamError(rateLimitError),
				(error: Error) => {
					assertRateLimitErrorWithRetry(error, '30');
					return true;
				}
			);
		});

		test('throws error without retry-after when rate limited without header', () => {
			const rateLimitError = createVercelRateLimitError(undefined, 'https://api.localhost/anthropic/v1/messages');

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

	suite('Rate limit error handling (Native SDK path)', () => {
		test('throws error with retry-after when rate limited with header', async () => {
			const rateLimitError = createNativeRateLimitError('45');

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
					assertRateLimitErrorWithRetry(error, '45');
					return true;
				}
			);
		});

		test('throws error without retry-after when rate limited without header', async () => {
			const rateLimitError = createNativeRateLimitError();

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
					assertRateLimitErrorWithoutRetry(error);
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
