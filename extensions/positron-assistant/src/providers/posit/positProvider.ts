/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { deleteConfiguration, ModelConfig } from '../../config';
import { DEFAULT_MAX_TOKEN_OUTPUT, DEFAULT_MODEL_CAPABILITIES } from '../../constants';
import { log, recordRequestTokenUsage, recordTokenUsage } from '../../extension.js';
import { isCacheControlOptions, toAnthropicMessages, toAnthropicSystem, toAnthropicToolChoice, toAnthropicTools, toTokenUsage } from '../anthropic/anthropicProvider.js';
import { VercelModelProvider } from '../base/vercelModelProvider.js';
import { getAllModelDefinitions } from '../../modelDefinitions.js';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers.js';

export const DEFAULT_POSITAI_MODEL_NAME = 'Claude Sonnet 4.5';
export const DEFAULT_POSITAI_MODEL_MATCH = 'claude-sonnet-4-5';

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
	/** The cancellation token for the current operation. */
	private static _cancellationToken: vscode.CancellationTokenSource | null = null;

	private _anthropicClient!: Anthropic;
	private _useNativeSdk!: boolean;
	public readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'posit-ai',
			displayName: 'Posit AI'
		},
		supportedOptions: ['oauth'],
		defaults: {
			name: DEFAULT_POSITAI_MODEL_NAME,
			model: DEFAULT_POSITAI_MODEL_MATCH + '-20250929',
			toolCalls: true,
			oauth: true,
		},
	};

	private static getOAuthParameters() {
		const authHost: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('authHost', 'https://login.posit.cloud');
		const scope: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('scope', 'prism');
		const clientId: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('clientId', 'positron');
		const baseUrl: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('baseUrl', 'https://gateway.posit.ai');

		if (!authHost || !scope || !clientId || !baseUrl) {
			throw new Error('OAuth parameters are not configured.');
		}

		return { authHost, scope, clientId, baseUrl };
	}

	public static async signIn(context: vscode.ExtensionContext): Promise<void> {
		log.info('[Posit AI] Signing in.');

		const params = PositModelProvider.getOAuthParameters();
		const response = await fetch(
			`${params.authHost}/oauth/device/authorize?scope=${params.scope}&client_id=${params.clientId}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				}
			}
		);

		if (!response.ok) {
			throw new Error(`Failed to start device authorization: ${response.statusText}`);
		}

		const data = await response.json();
		const { verification_uri_complete, interval, user_code, device_code } = data;
		await vscode.env.clipboard.writeText(user_code);
		await positron.methods.showDialog(
			'Posit AI Sign In',
			`You will need this code to sign in: <code>${user_code}</code>. It has been copied to your clipboard.`,
		);
		await vscode.env.openExternal(vscode.Uri.parse(verification_uri_complete));

		const cancellationToken = new vscode.CancellationTokenSource();
		PositModelProvider._cancellationToken = cancellationToken;

		cancellationToken.token.onCancellationRequested(() => {
			vscode.window.showInformationMessage(vscode.l10n.t('Posit AI sign-in cancelled.'));
		});

		try {
			let currentInterval = interval;
			while (true) {
				if (cancellationToken.token.isCancellationRequested) {
					throw new Error('Posit AI sign-in cancelled.');
				}

				const tokenResponse = await fetch(
					`${params.authHost}/oauth/token`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded'
						},
						body: new URLSearchParams({
							scope: params.scope,
							client_id: params.clientId,
							grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
							device_code: device_code
						}).toString()
					}
				);

				if (tokenResponse.status === 200) {
					const tokenData = await tokenResponse.json();
					const { access_token, refresh_token, expires_in } = tokenData;
					log.info('[Posit AI] Sign-in successful.');

					const expiryTime = Date.now() + expires_in * 1000;
					context.secrets.store('positron.assistant.positai.access_token', access_token);
					context.secrets.store('positron.assistant.positai.refresh_token', refresh_token);
					context.secrets.store('positron.assistant.positai.token_expiry', expiryTime.toString());
					break;
				}

				if (tokenResponse.status === 400) {
					const errorData = await tokenResponse.json();
					switch (errorData.error) {
						case 'authorization_pending':
							await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));
							continue;
						case 'slow_down':
							currentInterval += 5;
							await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));
							continue;
						case 'expired_token':
							vscode.window.showErrorMessage(vscode.l10n.t('Your verification code has expired. Please try signing in again.'));
							throw new Error('Verification code expired.');
						case 'access_denied':
							vscode.window.showErrorMessage(vscode.l10n.t('Authorization request was denied.'));
							throw new Error('Authorization denied.');
						default:
							throw new Error(`Unexpected error during token exchange: ${errorData.error}`);
					}
				} else {
					throw new Error(`Unexpected response from token endpoint: ${tokenResponse.statusText}`);
				}
			}
		} finally {
			cancellationToken.dispose();
		}

		return;
	}

	public static async signOut(context: vscode.ExtensionContext): Promise<boolean> {
		log.info('[Posit AI] Signing out.');

		try {
			// Sign-out is considered successful when the model is deleted in the config service
			context.secrets.delete('positron.assistant.positai.access_token');
			context.secrets.delete('positron.assistant.positai.refresh_token');
			context.secrets.delete('positron.assistant.positai.token_expiry');
			return true;
		} catch (error) {
			if (error instanceof Error) {
				vscode.window.showErrorMessage(vscode.l10n.t('Failed to sign out of Posit AI: {0}', error.message));
			} else {
				vscode.window.showErrorMessage(vscode.l10n.t('Failed to sign out of Posit AI.'));
			}
			return false;
		}
	}

	public static cancelCurrentSignIn(): void {
		PositModelProvider._cancellationToken?.cancel();
		PositModelProvider._cancellationToken?.dispose();
		PositModelProvider._cancellationToken = null;
	}

	public static async refreshAccessToken(context: vscode.ExtensionContext): Promise<{ success: false } | { success: true; accessToken: string }> {
		log.info('[Posit AI] Refreshing access token.');
		const params = PositModelProvider.getOAuthParameters();

		const refreshToken = await context.secrets.get('positron.assistant.positai.refresh_token');
		if (!refreshToken) {
			log.error('[Posit AI] No refresh token found.');
			return { success: false };
		}

		const response = await fetch(
			`${params.authHost}/oauth/token`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams({
					scope: params.scope,
					client_id: params.clientId,
					grant_type: 'refresh_token',
					refresh_token: refreshToken
				}).toString()
			}
		);

		if (!response.ok) {
			const errorData = await response.json();
			const errorMsg = errorData.error_description || response.statusText;
			log.error(`[Posit AI] Failed to refresh token: ${errorMsg}`);
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to refresh Posit AI access token: {0}', errorMsg));
			return { success: false };
		}

		const tokenData = await response.json();
		const { access_token, refresh_token, expires_in } = tokenData;
		const expiryTime = Date.now() + expires_in * 1000;

		await context.secrets.store('positron.assistant.positai.access_token', access_token);
		await context.secrets.store('positron.assistant.positai.refresh_token', refresh_token);
		await context.secrets.store('positron.assistant.positai.token_expiry', expiryTime.toString());

		log.info('[Posit AI] Access token refreshed successfully.');
		return { success: true, accessToken: access_token };
	}

	constructor(
		_config: ModelConfig,
		_context?: vscode.ExtensionContext,
	) {
		super(_config, _context);
	}

	/**
	 * Initializes the Posit AI provider with OAuth-authenticated Anthropic client.
	 * Uses either native Anthropic SDK or Vercel AI SDK based on the useAnthropicSdk preference.
	 */
	protected override initializeProvider() {
		const params = PositModelProvider.getOAuthParameters();

		// Check preference: true (default) = native SDK, false = Vercel SDK
		this._useNativeSdk = vscode.workspace.getConfiguration('positron.assistant')
			.get('useAnthropicSdk', true);

		if (this._useNativeSdk) {
			// Initialize native Anthropic SDK (existing behavior)
			this._anthropicClient = new Anthropic({
				authToken: '_', // Actual token is set in authFetch
				apiKey: '_',   // API key is not used
				fetch: this.authFetch.bind(this),
				baseURL: `${params.baseUrl}/anthropic`,
			});
		} else {
			// Initialize Vercel AI SDK provider with OAuth fetch
			// Note: Vercel SDK expects baseURL to include /v1 (default is https://api.anthropic.com/v1)
			this.aiProvider = createAnthropic({
				baseURL: `${params.baseUrl}/anthropic/v1`,
				fetch: this.authFetch.bind(this),
			});
		}
	}

	/**
	 * Custom fetch implementation that adds OAuth Bearer token to requests.
	 */
	private async authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
		const token = await this.getAccessToken();
		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${token}`);
		return fetch(input, { ...init, headers });
	}

	/**
	 * Gets the current access token, refreshing if necessary.
	 */
	async getAccessToken(): Promise<string> {
		let accessToken = await this._context!.secrets.get('positron.assistant.positai.access_token');
		const tokenExpiry = await this._context!.secrets.get('positron.assistant.positai.token_expiry');

		this.logger.debug(`Token expiry at ${tokenExpiry}. Current time is ${Date.now()}.`);

		const tenMin = 10 * 60 * 1000;
		const expiry = parseInt(tokenExpiry) - tenMin;
		if (tokenExpiry && Date.now() >= expiry) {
			this.logger.info('Access token has expired.');
			const result = await PositModelProvider.refreshAccessToken(this._context!);
			if (!result.success) {
				deleteConfiguration(this._context, this.providerId);
				throw new Error('Failed to refresh Posit AI access token. Please sign in again.');
			}
			accessToken = result.accessToken;
		}

		return accessToken;
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
				let data: any;
				try {
					data = JSON.parse(error.message);
				} catch {
					// Ignore JSON parse errors.
				}
				if (data?.error?.type === 'overloaded_error') {
					throw new Error(`API is temporarily overloaded.`);
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
		if (message.usage && this._context) {
			const tokens = toTokenUsage(message.usage);
			recordTokenUsage(this._context, this.providerId, tokens);

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
	 * Retrieves models from configuration.
	 * Overrides base implementation to use Posit AI specific default model matching.
	 */
	protected override retrieveModelsFromConfig() {
		return super.retrieveModelsFromConfig();
	}

	protected override async retrieveModelsFromApi(): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		try {
			const params = PositModelProvider.getOAuthParameters();
			const modelListing: vscode.LanguageModelChatInformation[] = [];
			const knownPositModels = getAllModelDefinitions(this.providerId);

			log.trace(`[${this.providerName}] Fetching models from Posit API...`);

			const response = await this.authFetch(`${params.baseUrl}/models`);

			if (!response.ok) {
				throw new Error(`API returned ${response.status}`);
			}

			const data = await response.json() as { chat: Array<{ display_name: string; id: string; max_context_length?: number }> };
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
			log.warn(`[${this.providerName}] Failed to fetch models from Posit API: ${error}`);
			return undefined;
		}
	}
}
