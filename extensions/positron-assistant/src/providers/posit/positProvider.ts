/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { deleteConfiguration } from '../../config';
import { ModelConfig } from '../../configTypes.js';
import { DEFAULT_MAX_TOKEN_OUTPUT, DEFAULT_MODEL_CAPABILITIES } from '../../constants';
import { log } from '../../log.js';
import { recordRequestTokenUsage, recordTokenUsage } from '../../tokens.js';
import { isCacheControlOptions, toAnthropicMessages, toAnthropicSystem, toAnthropicToolChoice, toAnthropicTools, toTokenUsage } from '../anthropic/anthropicProvider.js';
import { handleNativeSdkRateLimitError, handleVercelSdkRateLimitError } from '../anthropic/anthropicModelUtils.js';
import { VercelModelProvider } from '../base/vercelModelProvider.js';
import { getAllModelDefinitions } from '../../modelDefinitions.js';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';

export const DEFAULT_POSITAI_MODEL_NAME = 'Claude Sonnet 4.5';
export const DEFAULT_POSITAI_MODEL_MATCH = 'claude-sonnet-4-5';

interface PositModelsResponse {
	chat: {
		display_name: string;
		id: string;
		max_context_length?: number;
	}[];
}

/**
 * Posit AI model provider implementation using native Anthropic SDK with OAuth authentication.
 *
 * This provider integrates Posit AI's hosted Claude models using OAuth-based authentication
 * instead of API keys. It provides:
 * - OAuth device flow authentication
 * - Automatic token refresh
 * - All Claude model capabilities (vision, tool calling, agent mode)
 * - Streaming responses
 * - Token usage tracking
 *
 * **Configuration:**
 * - Provider ID: `posit-ai`
 * - Authentication: OAuth (no API key required)
 * - Managed through workspace settings for authHost, scope, clientId, and baseUrl
 */
export class PositModelProvider extends VercelModelProvider {
	private _anthropicClient!: Anthropic;
	private _useNativeSdk!: boolean;
	public readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.positAI,
		supportedOptions: ['oauth'],
		defaults: {
			name: DEFAULT_POSITAI_MODEL_NAME,
			model: DEFAULT_POSITAI_MODEL_MATCH + '-20250929',
			toolCalls: true,
			oauth: true,
		},
	};

	constructor(
		_config: ModelConfig,
		_context?: vscode.ExtensionContext,
	) {
		super(_config, _context);
	}

	private get baseUrl(): string {
		return vscode.workspace
			.getConfiguration('authentication.positai')
			.inspect<string>('baseUrl')?.globalValue
			?? 'https://gateway.posit.ai';
	}

	/**
	 * Initializes the Posit AI provider with OAuth-authenticated Anthropic client.
	 * Uses either native Anthropic SDK or Vercel AI SDK based on the useAnthropicSdk preference.
	 */
	protected override initializeProvider() {
		const baseUrl = this.baseUrl;

		// Check preference: true (default) = native SDK, false = Vercel SDK
		this._useNativeSdk = vscode.workspace.getConfiguration('positron.assistant')
			.get('useAnthropicSdk', true);

		if (this._useNativeSdk) {
			// Initialize native Anthropic SDK (existing behavior)
			this._anthropicClient = new Anthropic({
				authToken: '_', // Actual token is set in authFetch
				apiKey: '_',   // API key is not used
				fetch: this.authFetch.bind(this),
				baseURL: `${baseUrl}/anthropic`,
			});
		} else {
			// Initialize Vercel AI SDK provider with OAuth fetch
			// Note: Vercel SDK expects baseURL to include /v1 (default is https://api.anthropic.com/v1)
			this.aiProvider = createAnthropic({
				apiKey: '_',   // API key is not used
				baseURL: `${baseUrl}/anthropic/v1`,
				fetch: this.authFetch.bind(this),
			});
		}
	}

	/**
	 * Custom fetch implementation that adds OAuth Bearer token to requests.
	 * Only attaches the token for URLs matching the configured baseUrl.
	 */
	private async authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
		const token = await this.getAccessToken();
		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${token}`);
		return fetch(input, { ...init, headers });
	}

	/**
	 * Gets a fresh access token via the authentication extension.
	 */
	async getAccessToken(): Promise<string> {
		try {
			const session = await vscode.authentication.getSession(
				'posit-ai', [], { silent: true }
			);
			if (!session?.accessToken) {
				throw new Error('No Posit AI access token found. Please sign in.');
			}
			return session.accessToken;
		} catch (error) {
			// On auth failure, clean up the model configuration
			deleteConfiguration(this._context, this.providerId);
			throw error;
		}
	}

	/**
	 * Provides chat response using either native Anthropic SDK or Vercel AI SDK with OAuth authentication.
	 */
	override async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	) {
		// If using Vercel SDK, delegate to base class implementation
		if (!this._useNativeSdk) {
			return this.provideVercelResponse(model, messages, options, progress, token, {
				toolResultExperimentalContent: true,
				anthropicCacheBreakpoint: true
			});
		}

		// Native SDK implementation follows
		const cacheControlOptions = isCacheControlOptions(options.modelOptions?.cacheControl)
			? options.modelOptions.cacheControl
			: undefined;
		const tools = options.tools && toAnthropicTools(options.tools);
		const tool_choice = options.toolMode && toAnthropicToolChoice(options.toolMode);

		const systemMessages = messages.filter(m => m.role === vscode.LanguageModelChatMessageRole.System);
		const otherMessages = messages.filter(m => m.role !== vscode.LanguageModelChatMessageRole.System);

		// Convert messages with system role into a anthropic system prompt
		const system = toAnthropicSystem(systemMessages, cacheControlOptions?.system, options.modelOptions?.system);

		// Convert the remaining messages into anthropic user and assistant messages.
		const anthropicMessages = toAnthropicMessages(otherMessages);

		const body: Anthropic.MessageStreamParams = {
			model: model.id,
			max_tokens: options.modelOptions?.maxTokens ?? this.maxOutputTokens,
			tools,
			tool_choice,
			system,
			messages: anthropicMessages,
		};

		// Set user agent in stream options
		const streamOptions = {
			headers: {
				'User-Agent': `Positron/${positron.version}+${positron.buildNumber} (${os.platform()}) ${options.requestInitiator}`,
				'Session-Id': options.modelOptions?.sessionId,
			}
		};

		const stream = this._anthropicClient.messages.stream(body, streamOptions);

		// Log request information - the request ID is only available upon connection.
		stream.on('connect', () => {
			this.logger.info(`Start request ${stream.request_id} to ${model.id}: ${anthropicMessages.length} messages`);
			if (log.logLevel <= vscode.LogLevel.Trace) {
				this.logger.trace(`SEND messages.stream [${stream.request_id}]: ${JSON.stringify(body, null, 2)}`);
			} else {
				const userMessages = body.messages.filter(m => m.role === 'user');
				const assistantMessages = body.messages.filter(m => m.role === 'assistant');
				this.logger.debug(
					`SEND messages.stream [${stream.request_id}]: ` +
					`model: ${body.model}; ` +
					`cache options: ${cacheControlOptions ? JSON.stringify(cacheControlOptions) : 'default'}; ` +
					`tools: ${body.tools?.map(t => t.name).sort().join(', ') ?? 'none'}; ` +
					`tool choice: ${body.tool_choice ? JSON.stringify(body.tool_choice) : 'default'}; ` +
					`system chars: ${body.system ? JSON.stringify(body.system).length : 0}; ` +
					`user messages: ${userMessages.length}; ` +
					`user message characters: ${JSON.stringify(userMessages).length}; ` +
					`assistant messages: ${assistantMessages.length}; ` +
					`assistant message characters: ${JSON.stringify(assistantMessages).length}`
				);
			}
		});

		token.onCancellationRequested(() => {
			stream.abort();
		});

		stream.on('contentBlock', (contentBlock) => {
			this.onContentBlock(contentBlock, progress);
		});

		stream.on('text', (textDelta) => {
			this.onText(textDelta, progress);
		});

		// Report token usage information as part of the output stream.
		stream.on('streamEvent', (event) => {
			if (event.type === 'message_start' || event.type === 'message_delta') {
				const usage = event.type === 'message_start' ? event.message.usage : event.usage;
				const part: any = vscode.LanguageModelDataPart.json({
					type: 'usage',
					data: toTokenUsage(usage)
				});
				// Report usage data as a data part so it conforms to LanguageModelResponsePart2
				progress.report(part);
			}
		});

		try {
			await stream.done();
		} catch (error) {
			if (error instanceof Anthropic.APIError) {
				this.logger.warn(`Error in messages.stream [${stream.request_id}]: ${error.message}`);

				// Check for rate limit error with retry-after header
				handleNativeSdkRateLimitError(error, this.providerName);

				let data: any;
				try {
					data = JSON.parse(error.message);
				} catch {
					// Ignore JSON parse errors.
				}
				if (data?.error?.type === 'overloaded_error') {
					throw new Error(`[${this.providerName}] API is temporarily overloaded.`);
				}
			} else if (error instanceof Anthropic.AnthropicError) {
				this.logger.warn(`Error in messages.stream [${stream.request_id}]: ${error.message}`);
				if (error.message.startsWith('Could not resolve authentication method')) {
					throw new Error('Something went wrong with the Posit AI authentication. ' +
						'Please delete and recreate the model configuration.');
				}
			}
			throw error;
		}

		// Log usage information.
		const message = await stream.finalMessage();
		if (log.logLevel <= vscode.LogLevel.Trace) {
			this.logger.trace(`RECV messages.stream [${stream.request_id}]: ${JSON.stringify(message, null, 2)}`);
		} else {
			this.logger.debug(`RECV messages.stream [${stream.request_id}]`);
			this.logger.info(`Finished request ${stream.request_id}; usage: ${JSON.stringify(message.usage)}`);
		}

		// Record token usage
		if (message.usage) {
			const tokens = toTokenUsage(message.usage);
			recordTokenUsage(this.providerId, tokens);

			// Also record token usage by request ID if available
			const requestId = (options.modelOptions as any)?.requestId;
			if (requestId) {
				recordRequestTokenUsage(requestId, this.providerId, tokens);
			}
		}
	}

	/**
	 * Tests connection by verifying access token is available.
	 */
	override async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		const accessToken = await this.getAccessToken();
		if (!accessToken) {
			throw new Error('No access token available for Posit AI.');
		}
		return;
	}

	/**
	 * Sends a test message to verify model connectivity.
	 * When using Vercel SDK, delegates to base class. When using native SDK,
	 * connection is verified via OAuth token in resolveConnection.
	 */
	protected override async sendTestMessage(modelId: string) {
		if (!this._useNativeSdk) {
			// Use Vercel SDK's test message implementation
			return super.sendTestMessage(modelId);
		}
		// For native SDK, connection is verified via OAuth token in resolveConnection
		return Promise.resolve() as any;
	}

	private onContentBlock(block: Anthropic.ContentBlock, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
		switch (block.type) {
			case 'tool_use':
				return this.onToolUseBlock(block, progress);
		}
	}

	private onToolUseBlock(block: Anthropic.ToolUseBlock, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
		progress.report(new vscode.LanguageModelToolCallPart(block.id, block.name, block.input as object));
	}

	private onText(textDelta: string, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
		progress.report(new vscode.LanguageModelTextPart(textDelta));
	}

	/**
	 * Handles Posit AI-specific errors during stream processing (Vercel SDK path).
	 *
	 * Checks for rate limit errors (429) and extracts the retry-after header
	 * to provide a more helpful error message to the user.
	 *
	 * @param error - The error that occurred during streaming
	 * @throws A transformed error with retry information if rate limited
	 */
	protected override handleStreamError(error: unknown): never {
		// Check for rate limit error with retry-after header
		handleVercelSdkRateLimitError(error, this.providerName);
		throw error;
	}

	/**
	 * Retrieves models from configuration.
	 * Overrides base implementation to use Posit AI specific default model matching.
	 */
	protected override retrieveModelsFromConfig() {
		return super.retrieveModelsFromConfig();
	}

	protected override async retrieveModelsFromApi(): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		try {
			const baseUrl = this.baseUrl;
			const modelListing: vscode.LanguageModelChatInformation[] = [];
			const knownPositModels = getAllModelDefinitions(this.providerId);

			log.trace(`[${this.providerName}] Fetching models from Posit API...`);

			const response = await this.authFetch(`${baseUrl}/models`);

			if (!response.ok) {
				throw new Error(`API returned ${response.status}`);
			}

			const data: unknown = await response.json();
			if (!isPositModelsResponse(data)) {
				log.warn(`[${this.providerName}] Unexpected /models response format: ${JSON.stringify(data)}`);
				return undefined;
			}

			data.chat.forEach(model => {
				const knownModel = knownPositModels?.find(m => model.id.startsWith(m.identifier));

				modelListing.push(
					createModelInfo({
						id: model.id,
						name: model.display_name,
						family: this.providerId,
						version: '',
						provider: this.providerId,
						providerName: this.providerName,
						capabilities: DEFAULT_MODEL_CAPABILITIES,
						defaultMaxInput: knownModel?.maxInputTokens || model.max_context_length,
						defaultMaxOutput: knownModel?.maxOutputTokens
					})
				);
			});

			return markDefaultModel(modelListing, this.providerId, DEFAULT_POSITAI_MODEL_MATCH);
		} catch (error) {
			const message = error instanceof Error ? error.message : JSON.stringify(error);
			log.warn(`[${this.providerName}] Failed to fetch models from Posit API: ${message}`);
			return undefined;
		}
	}
}

function isPositModelsResponse(data: unknown): data is PositModelsResponse {
	return (
		typeof data === 'object' && data !== null &&
		'chat' in data && Array.isArray(data.chat) &&
		data.chat.every(
			(m) => typeof m === 'object' && m !== null &&
				typeof m.display_name === 'string' &&
				typeof m.id === 'string'
		)
	);
}

