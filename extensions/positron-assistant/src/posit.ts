/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { deleteConfiguration, ModelConfig, SecretStorage } from './config';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { log, recordRequestTokenUsage, recordTokenUsage } from './extension.js';
import { isCacheControlOptions, toAnthropicMessages, toAnthropicSystem, toAnthropicToolChoice, toAnthropicTools, toTokenUsage } from './anthropic.js';
import { getAllModelDefinitions } from './modelDefinitions.js';
import { createModelInfo, markDefaultModel } from './modelResolutionHelpers.js';
import { applyModelFilters } from './modelFilters.js';

export const DEFAULT_POSITAI_MODEL_NAME = 'Claude Sonnet 4.5';
export const DEFAULT_POSITAI_MODEL_MATCH = 'claude-sonnet-4-5';

export class PositLanguageModel implements positron.ai.LanguageModelChatProvider {
	name: string;
	provider: string;
	family: string;
	id: string;
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	tokenCount: number = 0;
	modelListing: vscode.LanguageModelChatInformation[];

	/** The cancellation token for the current operation. */
	private static _cancellationToken: vscode.CancellationTokenSource | null = null;

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	private readonly _anthropicClient: Anthropic;

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
		const authHost: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('authHost', '');
		const scope: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('scope', '');
		const clientId: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('clientId', '');
		const baseUrl: string = vscode.workspace.getConfiguration('positron.assistant.positai').get('baseUrl', '');

		if (!authHost || !scope || !clientId || !baseUrl) {
			throw new Error('OAuth parameters are not configured.');
		}

		return { authHost, scope, clientId, baseUrl };
	}

	public static async signIn(storage: SecretStorage): Promise<void> {
		log.info('[Posit AI] Signing in.');

		const params = PositLanguageModel.getOAuthParameters();
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
		PositLanguageModel._cancellationToken = cancellationToken;

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
					storage.store('positron.assistant.positai.access_token', access_token);
					storage.store('positron.assistant.positai.refresh_token', refresh_token);
					storage.store('positron.assistant.positai.token_expiry', expiryTime.toString());
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

	public static async signOut(storage: SecretStorage): Promise<boolean> {
		log.info('[Posit AI] Signing out.');

		try {
			// Sign-out is considered successful when the model is deleted in the config service
			storage.delete('positron.assistant.positai.access_token');
			storage.delete('positron.assistant.positai.refresh_token');
			storage.delete('positron.assistant.positai.token_expiry');
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
		PositLanguageModel._cancellationToken?.cancel();
		PositLanguageModel._cancellationToken?.dispose();
		PositLanguageModel._cancellationToken = null;
	}

	public static async refreshAccessToken(storage: SecretStorage): Promise<{ success: false } | { success: true; accessToken: string }> {
		log.info('[Posit AI] Refreshing access token.');
		const params = PositLanguageModel.getOAuthParameters();

		const refreshToken = await storage.get('positron.assistant.positai.refresh_token');
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

		await storage.store('positron.assistant.positai.access_token', access_token);
		await storage.store('positron.assistant.positai.refresh_token', refresh_token);
		await storage.store('positron.assistant.positai.token_expiry', expiryTime.toString());

		log.info('[Posit AI] Access token refreshed successfully.');
		return { success: true, accessToken: access_token };
	}

	constructor(
		private readonly _config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext,
		private readonly _storage?: SecretStorage,
	) {
		this.name = _config.name;
		this.family = this.provider = _config.provider;
		this.id = _config.id;
		const params = PositLanguageModel.getOAuthParameters();
		this._anthropicClient = new Anthropic({
			authToken: '_', // Actual token is set in authFetch
			fetch: this.authFetch.bind(this),
			baseURL: `${params.baseUrl}/anthropic`,
		});
		this.version = '';
		this.maxInputTokens = _config.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT;
		this.maxOutputTokens = _config.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT;
		this.modelListing = [];
	}

	get providerName(): string {
		return PositLanguageModel.source.provider.displayName;
	}

	private async authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
		const token = await this.getAccessToken();
		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${token}`);
		return fetch(input, { ...init, headers });
	}

	async getAccessToken(): Promise<string> {
		let accessToken = await this._storage.get('positron.assistant.positai.access_token');
		const tokenExpiry = await this._storage.get('positron.assistant.positai.token_expiry');

		log.debug(`[Posit AI] Token expiry at ${tokenExpiry}. Current time is ${Date.now()}.`);

		const tenMin = 10 * 60 * 1000;
		const expiry = parseInt(tokenExpiry) - tenMin;
		if (tokenExpiry && Date.now() >= expiry) {
			log.info('[Posit AI] Access token has expired.');
			const result = await PositLanguageModel.refreshAccessToken(this._storage);
			if (!result.success) {
				deleteConfiguration(this._context, this._storage, this.provider);
				throw new Error('Failed to refresh Posit AI access token. Please sign in again.');
			}
			accessToken = result.accessToken;
		}

		return accessToken;
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	) {
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
			log.info(`[Posit AI] Start request ${stream.request_id} to ${model.id}: ${anthropicMessages.length} messages`);
			if (log.logLevel <= vscode.LogLevel.Trace) {
				log.trace(`[Posit AI] SEND messages.stream [${stream.request_id}]: ${JSON.stringify(body, null, 2)}`);
			} else {
				const userMessages = body.messages.filter(m => m.role === 'user');
				const assistantMessages = body.messages.filter(m => m.role === 'assistant');
				log.debug(
					`[Posit AI] SEND messages.stream [${stream.request_id}]: ` +
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
				log.warn(`[Posit AI] Error in messages.stream [${stream.request_id}]: ${error.message}`);
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
				log.warn(`[Posit AI] Error in messages.stream [${stream.request_id}]: ${error.message}`);
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
			log.trace(`[Posit AI] RECV messages.stream [${stream.request_id}]: ${JSON.stringify(message, null, 2)}`);
		} else {
			log.debug(
				`[Posit AI] RECV messages.stream [${stream.request_id}]`);
			log.info(`[Posit AI] Finished request ${stream.request_id}; usage: ${JSON.stringify(message.usage)}`);
		}

		// Record token usage
		if (message.usage && this._context) {
			const tokens = toTokenUsage(message.usage);
			recordTokenUsage(this._context, this.provider, tokens);

			// Also record token usage by request ID if available
			const requestId = (options.modelOptions as any)?.requestId;
			if (requestId) {
				recordRequestTokenUsage(requestId, this.provider, tokens);
			}
		}
	}

	async provideLanguageModelChatInformation(_options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		log.debug(`[${this.providerName}] Preparing language model chat information...`);
		const models = await this.resolveModels(token) ?? [];

		log.debug(`[${this.providerName}] Resolved ${models.length} models.`);
		return this.filterModels(models);
	}

	async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2, token: vscode.CancellationToken): Promise<number> {
		const len = typeof text === 'string' ? text.length : JSON.stringify(text.content).length;
		return Math.ceil(len / 4);
	}

	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		const accessToken = await this.getAccessToken();
		if (!accessToken) {
			throw new Error('No access token available for Posit AI.');
		}
		return;
	}

	protected filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		return applyModelFilters(models, this.provider, this.providerName);
	}

	private onContentBlock(block: Anthropic.ContentBlock, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
		switch (block.type) {
			case 'tool_use':
				return this.onToolUseBlock(block, progress);
		}
	}

	private onToolUseBlock(block: Anthropic.ToolUseBlock, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
		progress.report(new vscode.LanguageModelToolCallPart(block.id, block.name, block.input as any));
	}

	private onText(textDelta: string, progress: vscode.Progress<vscode.LanguageModelResponsePart2>): void {
		progress.report(new vscode.LanguageModelTextPart(textDelta));
	}

	private retrieveModelsFromConfig(): vscode.LanguageModelChatInformation[] | undefined {
		// Check for configured models (user or built-in)
		const configuredModels = getAllModelDefinitions(this.provider);
		if (configuredModels.length === 0) {
			return undefined;
		}

		log.info(`[${this.provider}] Using ${configuredModels.length} configured models.`);

		const modelListing = configuredModels.map((modelDef) =>
			createModelInfo({
				id: modelDef.identifier,
				name: modelDef.name,
				family: this.provider,
				version: '',
				provider: this.provider,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: modelDef.maxInputTokens,
				defaultMaxOutput: modelDef.maxOutputTokens
			})
		);

		return markDefaultModel(modelListing, this.provider, DEFAULT_POSITAI_MODEL_MATCH);
	}

	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		log.debug(`[${this.provider}] Resolving models...`);

		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		log.warn(`[${this.provider}] No models available. Using fallback model.`);
		const fallbackModel = createModelInfo({
			id: PositLanguageModel.source.defaults.model,
			name: PositLanguageModel.source.defaults.name,
			family: this.provider,
			version: this._context?.extension.packageJSON.version ?? '',
			provider: this.provider,
			providerName: this.providerName,
			capabilities: this.capabilities,
			defaultMaxInput: this.maxInputTokens,
			defaultMaxOutput: this.maxOutputTokens
		});
		return [{ ...fallbackModel, isDefault: true }];
	}
}
