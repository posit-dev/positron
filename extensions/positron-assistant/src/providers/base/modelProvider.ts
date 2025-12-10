/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { ModelConfig, SecretStorage, getMaxConnectionAttempts, getProviderTimeoutMs } from '../../config';
import { processMessages, toAIMessage, isAuthorizationError } from '../../utils';
import { applyModelFilters } from '../../modelFilters';
import { TokenUsage } from '../../tokens';
import { getAllModelDefinitions } from '../../modelDefinitions';
import { createModelInfo, getMaxTokens, markDefaultModel } from '../../modelResolutionHelpers';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';
import { log, recordRequestTokenUsage, recordTokenUsage } from '../../extension';
import { ModelProviderLogger } from './modelProviderLogger';
import { AuthenticationError, ModelRetrievalError } from './modelProviderErrors';

export interface AutoconfigureResult {
	configured: boolean;
	message?: string;
}

/**
 * Abstract base class for all model providers.
 * Renamed from AILanguageModel to better reflect its purpose.
 *
 * This class provides common functionality for all model providers including:
 * - Connection resolution with retry logic
 * - Model filtering and retrieval
 * - Error handling
 * - Token counting
 * - Chat response streaming
 */
export abstract class ModelProvider implements positron.ai.LanguageModelChatProvider {
	public static source: positron.ai.LanguageModelSource;

	public readonly name: string;
	public readonly provider: string;
	public readonly id: string;

	/**
	 * The AI provider instance. Can be a Vercel AI SDK provider or custom implementation.
	 * Made optional to support non-Vercel SDK providers.
	 */
	protected aiProvider?: (id: string, options?: Record<string, any>) => ai.LanguageModelV1;

	/**
	 * Custom provider for non-Vercel SDK implementations.
	 */
	protected customProvider?: any;

	/**
	 * Type of provider implementation.
	 */
	protected providerType: 'vercel' | 'custom' = 'vercel';

	protected aiOptions: Record<string, any> = {};
	protected modelListing?: vscode.LanguageModelChatInformation[];
	protected logger: ModelProviderLogger;

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	constructor(
		protected readonly _config: ModelConfig,
		protected readonly _context?: vscode.ExtensionContext,
		protected readonly _storage?: SecretStorage,
	) {
		this.id = _config.id;
		this.name = _config.name;
		this.provider = _config.provider;
		this.logger = new ModelProviderLogger(this.providerName);
	}

	/**
	 * The display name of the provider.
	 * This must be implemented by each provider subclass.
	 */
	abstract get providerName(): string;

	/**
	 * Creates the AI provider instance.
	 * Override this method to provide custom AI provider initialization.
	 *
	 * @returns The AI provider instance or undefined for custom providers.
	 */
	protected abstract createAIProvider(): ((id: string, options?: Record<string, any>) => ai.LanguageModelV1) | undefined;

	/**
	 * Validates the provider's credentials.
	 * Override this method to implement provider-specific credential validation.
	 *
	 * @returns True if credentials are valid, false otherwise.
	 */
	protected async validateCredentials(): Promise<boolean> {
		// Default implementation - override in subclasses for specific validation
		return true;
	}

	/**
	 * Filters the available models based on configuration.
	 *
	 * @param models The list of models to filter.
	 * @returns The filtered list of models.
	 */
	protected filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		return applyModelFilters(models, this.provider, this.providerName);
	}

	/**
	 * Resolves connection with retry logic.
	 * Extracted from the original resolveConnection for reusability.
	 *
	 * @param token The cancellation token.
	 * @returns Error if connection failed, undefined if successful.
	 */
	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		this.logger.debug('Resolving connection...');

		token.onCancellationRequested(() => {
			return false;
		});

		// First validate credentials if needed
		const credentialsValid = await this.validateCredentials();
		if (!credentialsValid) {
			return new AuthenticationError(this.providerName, 'Invalid credentials');
		}

		let models = await this.resolveModels(token);
		if (!models || models.length === 0) {
			return new ModelRetrievalError(this.providerName, 'No models available for provider');
		}

		models = this.filterModels(models);
		if (models.length === 0) {
			return new ModelRetrievalError(this.providerName, 'No models available after applying filters');
		}

		return this.testModelConnectivity(models, token);
	}

	/**
	 * Tests connectivity with the available models.
	 * Extracted for better organization and reusability.
	 *
	 * @param models The models to test.
	 * @param token The cancellation token.
	 * @returns Error if all models failed, undefined if at least one succeeded.
	 */
	protected async testModelConnectivity(
		models: vscode.LanguageModelChatInformation[],
		token: vscode.CancellationToken
	): Promise<Error | undefined> {
		const maxModelsToTest = getMaxConnectionAttempts();
		const modelsToTest = models.slice(0, maxModelsToTest);

		this.logger.debug(`Testing up to ${modelsToTest.length} models for connectivity...`);

		const errors: string[] = [];

		// Try each model until one succeeds
		for (const modelInfo of modelsToTest) {
			if (token.isCancellationRequested) {
				return new Error(`Connection test cancelled`);
			}

			const model = modelInfo.id;

			try {
				await this.sendTestMessage(model);
				this.logger.debug(`'${model}' Test message sent successfully.`);
				return undefined; // Success! At least one model is working
			} catch (error) {
				this.logger.warn(`'${model}' Error sending test message`, error);
				const errorMsg = await this.parseProviderError(error) ||
					(ai.AISDKError.isInstance(error) ? error.message : JSON.stringify(error, null, 2));
				errors.push(errorMsg);
			}
		}

		// If we get here, all tested models failed
		const allErrors = errors.join('; ');
		this.logger.error(`All ${modelsToTest.length} tested models failed: ${allErrors}`);
		return new Error(`All tested models failed: ${allErrors}`);
	}

	/**
	 * Sends a test message to verify model connectivity.
	 *
	 * @param modelId The model ID to test.
	 * @returns The test response.
	 */
	protected async sendTestMessage(modelId: string): Promise<any> {
		if (this.providerType === 'vercel' && this.aiProvider) {
			return ai.generateText({
				model: this.aiProvider(modelId, this.aiOptions),
				prompt: `I'm checking to see if you're there. Respond only with the word "hello".`,
				abortSignal: AbortSignal.timeout(getProviderTimeoutMs()),
				maxRetries: 1, // Retry the request once in case of transient errors
			});
		} else if (this.customProvider) {
			// Handle custom provider test - override in subclass
			throw new Error('Custom provider test not implemented');
		}
		throw new Error('No provider configured');
	}

	/**
	 * Provides language model chat information.
	 *
	 * @param options The options for providing chat information.
	 * @param token The cancellation token.
	 * @returns The list of available models.
	 */
	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		this.logger.debug('Preparing language model chat information...');
		const models = this.modelListing ?? await this.resolveModels(token) ?? [];
		return this.filterModels(models);
	}

	/**
	 * Provides a language model chat response.
	 * This is the main method for handling chat interactions.
	 *
	 * @param model The model to use.
	 * @param messages The chat messages.
	 * @param options The response options.
	 * @param progress The progress reporter.
	 * @param token The cancellation token.
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		if (this.providerType === 'vercel' && this.aiProvider) {
			return this.provideVercelResponse(model, messages, options, progress, token);
		} else if (this.customProvider) {
			return this.provideCustomResponse(model, messages, options, progress, token);
		}
		throw new Error('No provider configured');
	}

	/**
	 * Provides a response using the Vercel AI SDK.
	 * This is the default implementation from the original AILanguageModel.
	 */
	protected async provideVercelResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		if (!this.aiProvider) {
			throw new Error('AI provider not configured');
		}

		const aiModel = this.aiProvider(model.id);
		const modelOptions = options.modelOptions ?? {};

		const controller = new AbortController();
		const signal = controller.signal;
		token.onCancellationRequested(() => controller.abort());

		let tools: Record<string, ai.Tool> | undefined;

		// Ensure all messages have content
		const processedMessages = processMessages(messages);

		// Only Anthropic currently supports experimental_content in tool results
		const toolResultExperimentalContent = this.provider === 'anthropic-api' ||
			aiModel.modelId.includes('anthropic');

		// Only select Bedrock models support cache breakpoints
		const bedrockCacheBreakpoint = this.provider === 'amazon-bedrock' &&
			!aiModel.modelId.includes('anthropic.claude-3-5');

		// Add system prompt from modelOptions.system, if provided
		if (modelOptions.system) {
			processedMessages.unshift(new vscode.LanguageModelChatMessage(
				vscode.LanguageModelChatMessageRole.System,
				modelOptions.system
			));
		}

		// Convert all messages to the Vercel AI format
		const aiMessages: ai.CoreMessage[] = toAIMessage(
			processedMessages,
			toolResultExperimentalContent,
			bedrockCacheBreakpoint
		);

		// Set up tools if provided
		if (options.tools && options.tools.length > 0) {
			tools = this.setupTools(options.tools);
		}

		const modelTools = this._config.toolCalls ? tools : undefined;
		const requestId = (options.modelOptions as any)?.requestId;

		this.logger.info(`[vercel] Start request ${requestId} to ${model.name} [${aiModel.modelId}]: ${aiMessages.length} messages`);
		this.logger.debug(`[${model.name}] SEND ${aiMessages.length} messages, ${modelTools ? Object.keys(modelTools).length : 0} tools`);

		// Stream the response
		const result = ai.streamText({
			model: aiModel,
			messages: aiMessages,
			maxSteps: modelOptions.maxSteps ?? 50,
			tools: modelTools,
			abortSignal: signal,
			maxTokens: getMaxTokens(aiModel.modelId, 'output', this._config.provider, this._config.maxOutputTokens, this.providerName),
		});

		await this.handleStreamResponse(result, model, progress, token, requestId);
	}

	/**
	 * Provides a response using a custom provider implementation.
	 * Override this method in subclasses that use custom providers.
	 */
	protected async provideCustomResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		throw new Error('Custom provider response not implemented. Override this method in your provider class.');
	}

	/**
	 * Sets up tools for the chat request.
	 *
	 * @param tools The tools to set up.
	 * @returns The configured tools.
	 */
	protected setupTools(tools: vscode.LanguageModelChatTool[]): Record<string, ai.Tool> {
		return tools.reduce((acc: Record<string, ai.Tool>, tool: vscode.LanguageModelChatTool) => {
			// Some providers require a type for all tool input schemas
			const input_schema = tool.inputSchema as Record<string, any> ?? {
				type: 'object',
				properties: {},
				required: [],
			};

			// Ensure schema has a type field
			if (!input_schema.type) {
				this.logger.warn(`Tool '${tool.name}' is missing input schema type; defaulting to 'object'`);
				input_schema.type = 'object';
			}

			acc[tool.name] = ai.tool({
				description: tool.description,
				parameters: ai.jsonSchema(input_schema),
			});
			return acc;
		}, {});
	}

	/**
	 * Handles the streaming response from the AI model.
	 *
	 * @param result The streaming result.
	 * @param model The model information.
	 * @param progress The progress reporter.
	 * @param token The cancellation token.
	 * @param requestId The request ID for tracking.
	 */
	protected async handleStreamResponse(
		result: any,
		model: vscode.LanguageModelChatInformation,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken,
		requestId?: string
	): Promise<void> {
		let accumulatedTextDeltas: string[] = [];

		const flushAccumulatedTextDeltas = () => {
			if (accumulatedTextDeltas.length > 0) {
				const combinedText = accumulatedTextDeltas.join('');
				this.logger.trace(`[${model.name}] RECV text-delta (${accumulatedTextDeltas.length} parts): ${combinedText}`);
				accumulatedTextDeltas = [];
			}
		};

		for await (const part of result.fullStream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (part.type === 'reasoning') {
				flushAccumulatedTextDeltas();
				this.logger.trace(`[${this._config.name}] RECV reasoning: ${part.textDelta}`);
				progress.report(new vscode.LanguageModelTextPart(part.textDelta));
			}

			if (part.type === 'text-delta') {
				accumulatedTextDeltas.push(part.textDelta);
				progress.report(new vscode.LanguageModelTextPart(part.textDelta));
			}

			if (part.type === 'tool-call') {
				flushAccumulatedTextDeltas();
				this.logger.trace(`[${this._config.name}] RECV tool-call: ${part.toolCallId} (${part.toolName}) with args: ${JSON.stringify(part.args)}`);
				progress.report(new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, part.args));
			}

			if (part.type === 'error') {
				flushAccumulatedTextDeltas();
				this.logger.warn(`[${model.name}] RECV error`, part.error);
				const errorMsg = await this.parseProviderError(part.error) ||
					(typeof part.error === 'string' ? part.error : JSON.stringify(part.error, null, 2));
				throw new Error(`[${model.name}] Error in chat response: ${errorMsg}`);
			}
		}

		// Flush any remaining accumulated text deltas
		flushAccumulatedTextDeltas();

		// Log warnings
		const warnings = await result.warnings;
		if (warnings) {
			for (const warning of warnings) {
				this.logger.warn(`[${model.id}] ${warning}`);
			}
		}

		// Handle token usage
		await this.handleTokenUsage(result, model, requestId);
	}

	/**
	 * Handles token usage tracking and reporting.
	 *
	 * @param result The AI result with usage information.
	 * @param model The model information.
	 * @param requestId The request ID for tracking.
	 */
	protected async handleTokenUsage(
		result: any,
		model: vscode.LanguageModelChatInformation,
		requestId?: string
	): Promise<void> {
		const usage = await result.usage;
		const metadata = await result.providerMetadata;
		const tokens: TokenUsage = {
			inputTokens: usage.promptTokens,
			outputTokens: usage.completionTokens,
			cachedTokens: 0,
			providerMetadata: metadata,
		};

		// Handle Bedrock-specific usage
		if (metadata && metadata.bedrock && metadata.bedrock.usage) {
			const metaUsage = metadata.bedrock.usage as Record<string, any>;
			tokens.inputTokens += metaUsage.cacheWriteInputTokens || 0;
			tokens.cachedTokens += metaUsage.cacheReadInputTokens || 0;

			// Report token usage information
			const part: any = vscode.LanguageModelDataPart.json({ type: 'usage', data: tokens });
			(part as any).report && (part as any).report(part);

			this.logger.debug(`[${model.name}]: Bedrock usage: ${JSON.stringify(usage, null, 2)}`);
		}

		if (requestId) {
			recordRequestTokenUsage(requestId, this.provider, tokens);
		}

		if (this._context) {
			recordTokenUsage(this._context, this.provider, tokens);
		}

		this.logger.info(`[vercel]: End request ${requestId}; usage: ${tokens.inputTokens} input tokens (+${tokens.cachedTokens} cached), ${tokens.outputTokens} output tokens`);
	}

	/**
	 * Provides token count for the given text or messages.
	 *
	 * @param model The model information.
	 * @param text The text or messages to count tokens for.
	 * @param token The cancellation token.
	 * @returns The estimated token count.
	 */
	async provideTokenCount(
		model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2,
		token: vscode.CancellationToken
	): Promise<number> {
		// TODO: This is a naive approximation, a model specific tokenizer should be used
		const len = typeof text === 'string' ? text.length : JSON.stringify(text.content).length;
		return Math.ceil(len / 4);
	}

	/**
	 * Parses provider-specific errors and returns user-friendly messages.
	 *
	 * @param error The error object returned by the provider.
	 * @returns A user-friendly error message or undefined if not specifically handled.
	 */
	async parseProviderError(error: any): Promise<string | undefined> {
		// Check for authorization errors (401/403)
		if (isAuthorizationError(error)) {
			let specificMessage = '';
			if (ai.APICallError.isInstance(error) && error.responseBody) {
				try {
					const parsed = JSON.parse(error.responseBody);
					if (parsed.message) {
						specificMessage = ` (${parsed.message})`;
					}
				} catch {
					// Ignore JSON parsing errors
				}
			}

			const authError = `Authentication failed${specificMessage}. Please check your credentials and try signing in again.`;
			this.logger.error(authError);
			throw new AuthenticationError(this.providerName, authError);
		}

		// Try to extract an API error message
		if (ai.APICallError.isInstance(error)) {
			const responseBody = error.responseBody;
			if (responseBody) {
				try {
					const json = JSON.parse(responseBody);
					return `${json.message ?? JSON.stringify(json)}`;
				} catch (_error) {
					return `API Error: ${responseBody}`;
				}
			}
		}

		return undefined;
	}

	/**
	 * Resolves the available language models.
	 * Each provider can override this method for custom model retrieval.
	 *
	 * @param token The cancellation token.
	 * @returns A promise that resolves to an array of language model descriptors or undefined if unsupported.
	 */
	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		this.logger.debug('Resolving models...');

		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		// Try to retrieve models from API
		const apiModels = await this.retrieveModelsFromApi(token);
		if (apiModels) {
			this.modelListing = apiModels;
			return apiModels;
		}

		// Fallback to default model if no configured models available
		const defaultModel = this.createDefaultModel();
		this.modelListing = defaultModel;
		return defaultModel;
	}

	/**
	 * Retrieves models from configuration.
	 *
	 * @returns The configured models or undefined if none.
	 */
	protected retrieveModelsFromConfig(): vscode.LanguageModelChatInformation[] | undefined {
		const configuredModels = getAllModelDefinitions(this.provider);
		if (configuredModels.length === 0) {
			return undefined;
		}

		this.logger.info(`Using ${configuredModels.length} configured models.`);

		if (!this.aiProvider) {
			this.aiProvider = this.createAIProvider();
		}

		const models: vscode.LanguageModelChatInformation[] = configuredModels.map(model =>
			createModelInfo({
				id: model.identifier,
				name: model.name,
				family: this.provider,
				version: this.aiProvider ? this.aiProvider(model.identifier).specificationVersion : '1.0',
				provider: this.provider,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: model.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT,
				defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
			})
		);

		return markDefaultModel(models, this.provider, this._config.model);
	}

	/**
	 * Retrieves models from the provider's API.
	 * Override this method in subclasses to implement API-based model retrieval.
	 *
	 * @param token The cancellation token.
	 * @returns The models retrieved from the API or undefined.
	 */
	protected async retrieveModelsFromApi(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		// Default implementation - override in subclasses
		return undefined;
	}

	/**
	 * Creates a default model when no other models are available.
	 *
	 * @returns The default model information.
	 */
	protected createDefaultModel(): vscode.LanguageModelChatInformation[] {
		this.logger.info('No models available; returning default model information.');

		if (!this.aiProvider) {
			this.aiProvider = this.createAIProvider();
		}

		if (this.aiProvider) {
			const aiModel = this.aiProvider(this._config.model, this.aiOptions);
			const modelInfo = createModelInfo({
				id: aiModel.modelId,
				name: this.name,
				family: aiModel.provider,
				version: aiModel.specificationVersion,
				provider: this._config.provider,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: this._config.maxInputTokens,
				defaultMaxOutput: this._config.maxOutputTokens
			});
			return [{ ...modelInfo, isDefault: true }];
		}

		// For custom providers
		const modelInfo = createModelInfo({
			id: this._config.model,
			name: this.name,
			family: this.provider,
			version: '1.0',
			provider: this._config.provider,
			providerName: this.providerName,
			capabilities: this.capabilities,
			defaultMaxInput: this._config.maxInputTokens,
			defaultMaxOutput: this._config.maxOutputTokens
		});
		return [{ ...modelInfo, isDefault: true }];
	}

	/**
	 * Handles authentication errors consistently.
	 *
	 * @param error The authentication error.
	 * @returns A user-friendly error message.
	 */
	protected handleAuthenticationError(error: any): string {
		const message = error.message || 'Authentication failed';
		this.logger.error(`Authentication error: ${message}`);
		return `${message}. Please check your credentials and try signing in again.`;
	}

	/**
	 * Autoconfigures the language model, if supported.
	 * May implement functionality such as checking for environment variables or assessing managed credentials.
	 * @returns A promise that resolves to the autoconfigure result.
	 */
	static autoconfigure?: () => Promise<AutoconfigureResult>;
}