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

/**
 * Result of provider autoconfiguration attempt.
 *
 * @deprecated Use {@link AutoconfigureResult} from modelProviderTypes.ts instead.
 */
export interface AutoconfigureResult {
	/**
	 * Whether the provider was successfully configured.
	 */
	configured: boolean;

	/**
	 * Optional message describing the configuration result or any issues encountered.
	 */
	message?: string;

	/**
	 * Configuration values that were set during autoconfiguration.
	 * For example: { apiKey: string, baseUrl: string }
	 */
	configuration?: Record<string, any>;
}

/**
 * Abstract base class for all model providers in the Positron Assistant extension.
 *
 * This class provides a unified interface for interacting with various AI model providers
 * (Anthropic, OpenAI, Google, Azure, etc.) through a consistent API. It implements the
 * {@link positron.ai.LanguageModelChatProvider} interface to integrate with Positron's
 * language model system.
 *
 * Key responsibilities:
 * - Connection resolution with retry logic and timeout handling
 * - Model discovery and filtering based on capabilities and configuration
 * - Credential validation and authentication error handling
 * - Token counting and usage tracking
 * - Chat response streaming with progress reporting
 * - Tool/function calling support
 * - Provider-specific error parsing
 *
 * Providers can be implemented in two ways:
 * 1. **Vercel AI SDK providers** (default): Use the Vercel AI SDK for model interactions
 * 2. **Custom providers**: Implement custom logic for providers not supported by Vercel AI SDK
 *
 * @example
 * ```typescript
 * class MyProvider extends ModelProvider {
 *   get providerName(): string {
 *     return 'My Provider';
 *   }
 *
 *   protected createAIProvider() {
 *     return createMyProvider({ apiKey: this._config.apiKey });
 *   }
 * }
 * ```
 *
 * @see {@link ModelProviderLogger} for logging functionality
 * @see {@link ModelProviderErrors} for error types
 */
export abstract class ModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * Static metadata describing the provider's configuration and capabilities.
	 * Each provider implementation must define this to describe its requirements.
	 */
	public static source: positron.ai.LanguageModelSource;

	/**
	 * Display name of the model instance.
	 */
	public readonly name: string;

	/**
	 * Provider ID (e.g., 'anthropic-api', 'openai-api', 'ollama').
	 */
	public readonly provider: string;

	/**
	 * Unique identifier for this model configuration.
	 */
	public readonly id: string;

	/**
	 * The AI provider instance for Vercel AI SDK-based providers.
	 * This function creates a language model instance given a model ID and optional configuration.
	 * Optional to support custom (non-Vercel SDK) provider implementations.
	 */
	protected aiProvider?: (id: string, options?: Record<string, any>) => ai.LanguageModelV1;

	/**
	 * Custom provider implementation for non-Vercel SDK providers.
	 * Use this when the provider doesn't have a Vercel AI SDK integration.
	 */
	protected customProvider?: any;

	/**
	 * Type of provider implementation being used.
	 * - 'vercel': Uses Vercel AI SDK (default)
	 * - 'custom': Uses custom implementation
	 */
	protected providerType: 'vercel' | 'custom' = 'vercel';

	/**
	 * Additional options passed to the AI provider when creating model instances.
	 * Provider-specific options like temperature, top_p, etc.
	 */
	protected aiOptions: Record<string, any> = {};

	/**
	 * Cached list of available models for this provider.
	 * Populated after the first successful model resolution.
	 */
	protected modelListing?: vscode.LanguageModelChatInformation[];

	/**
	 * Logger instance for provider-specific logging with consistent formatting.
	 */
	protected logger: ModelProviderLogger;

	/**
	 * Default model capabilities supported by this provider.
	 * Subclasses can override to specify different capabilities.
	 */
	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	/**
	 * Creates a new model provider instance.
	 *
	 * @param _config - Configuration for this model provider including API keys, base URLs, and model settings
	 * @param _context - VS Code extension context for accessing storage and other extension features
	 * @param _storage - Secret storage for managing sensitive credentials
	 */
	constructor(
		protected readonly _config: ModelConfig,
		protected readonly _context?: vscode.ExtensionContext,
		protected readonly _storage?: SecretStorage,
	) {
		this.id = _config.id;
		this.name = _config.name;
		this.provider = _config.provider;
		// Logger initialization deferred to subclass since providerName is abstract
		this.logger = null as any; // Will be initialized by subclass calling initializeLogger()
	}

	/**
	 * Initializes the logger. Must be called by subclass constructor after providerName is available.
	 * @protected
	 */
	protected initializeLogger(): void {
		this.logger = new ModelProviderLogger(this.providerName);
	}

	/**
	 * Gets the human-readable display name of the provider.
	 *
	 * This name is used in UI elements and log messages to identify the provider.
	 * Each provider subclass must implement this to return its specific display name.
	 *
	 * @returns The display name of the provider (e.g., 'Anthropic', 'OpenAI', 'Ollama')
	 *
	 * @example
	 * ```typescript
	 * get providerName(): string {
	 *   return 'My Custom Provider';
	 * }
	 * ```
	 */
	abstract get providerName(): string;

	/**
	 * Creates the AI provider instance for this provider.
	 *
	 * This method is called during provider initialization to set up the underlying
	 * AI SDK provider (e.g., Anthropic, OpenAI). For Vercel AI SDK-based providers,
	 * return the provider factory function. For custom providers, return undefined
	 * and implement {@link provideCustomResponse} instead.
	 *
	 * @returns The AI provider factory function, or undefined for custom providers
	 *
	 * @example
	 * ```typescript
	 * // Vercel AI SDK provider
	 * protected createAIProvider() {
	 *   return createAnthropic({ apiKey: this._config.apiKey });
	 * }
	 *
	 * // Custom provider
	 * protected createAIProvider() {
	 *   this.customProvider = new MyCustomProvider();
	 *   this.providerType = 'custom';
	 *   return undefined;
	 * }
	 * ```
	 */
	protected abstract createAIProvider(): ((id: string, options?: Record<string, any>) => ai.LanguageModelV1) | undefined;

	/**
	 * Validates the provider's credentials before attempting to connect.
	 *
	 * This method is called during {@link resolveConnection} to verify that the
	 * provider has valid credentials before making API calls. The default
	 * implementation always returns true. Override this method to implement
	 * provider-specific credential validation (e.g., checking API key format,
	 * verifying token expiration).
	 *
	 * @returns A promise that resolves to true if credentials are valid, false otherwise
	 *
	 * @example
	 * ```typescript
	 * protected async validateCredentials(): Promise<boolean> {
	 *   if (!this._config.apiKey || this._config.apiKey.length < 10) {
	 *     return false;
	 *   }
	 *   return true;
	 * }
	 * ```
	 */
	protected async validateCredentials(): Promise<boolean> {
		// Default implementation - override in subclasses for specific validation
		return true;
	}

	/**
	 * Filters the available models based on user configuration and provider capabilities.
	 *
	 * This method applies configured filters to remove models that don't meet
	 * certain criteria (e.g., deprecated models, unsupported capabilities,
	 * user-defined exclusions). The filtering logic is implemented in
	 * {@link applyModelFilters}.
	 *
	 * @param models - The list of models to filter
	 * @returns The filtered list of models that meet the filter criteria
	 *
	 * @see {@link applyModelFilters} for filter implementation details
	 */
	protected filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		return applyModelFilters(models, this.provider, this.providerName);
	}

	/**
	 * Resolves and validates the connection to the AI provider.
	 *
	 * This method performs a complete connection setup workflow:
	 * 1. Validates credentials using {@link validateCredentials}
	 * 2. Retrieves available models using {@link resolveModels}
	 * 3. Applies filters to the model list
	 * 4. Tests connectivity by sending a test message to available models
	 *
	 * The method respects the cancellation token and will abort if cancellation
	 * is requested. It returns undefined on success or an Error describing the
	 * failure reason.
	 *
	 * @param token - Cancellation token to abort the connection attempt
	 * @returns A promise that resolves to undefined on success, or an Error if connection failed
	 *
	 * @throws {AuthenticationError} If credentials are invalid
	 * @throws {ModelRetrievalError} If no models are available or all models fail filtering
	 *
	 * @example
	 * ```typescript
	 * const error = await provider.resolveConnection(token);
	 * if (error) {
	 *   console.error('Connection failed:', error.message);
	 * } else {
	 *   console.log('Connection successful');
	 * }
	 * ```
	 *
	 * @see {@link testModelConnectivity} for connectivity testing details
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
	 * Tests connectivity with the available models by sending test messages.
	 *
	 * This method attempts to verify that at least one model from the provider
	 * is accessible and working correctly. It tests up to a configured number
	 * of models (controlled by {@link getMaxConnectionAttempts}) and returns
	 * success as soon as any model responds successfully.
	 *
	 * The method collects error messages from all failed attempts and returns
	 * a comprehensive error if all tested models fail.
	 *
	 * @param models - The list of models to test connectivity for
	 * @param token - Cancellation token to abort testing
	 * @returns A promise that resolves to undefined if at least one model succeeds,
	 *          or an Error containing all failure messages if all models fail
	 *
	 * @see {@link sendTestMessage} for the actual test implementation
	 * @see {@link getMaxConnectionAttempts} for configuring test limits
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
	 * Sends a test message to verify that a specific model is accessible and responsive.
	 *
	 * For Vercel AI SDK providers, this uses {@link ai.generateText} with a simple
	 * prompt and includes a timeout and retry logic. Custom providers must override
	 * this method to implement their own test logic.
	 *
	 * The test message is kept simple ("I'm checking to see if you're there...") to
	 * minimize token usage while still verifying end-to-end connectivity.
	 *
	 * @param modelId - The ID of the model to test
	 * @returns A promise that resolves to the test response from the model
	 *
	 * @throws {Error} If the provider type is not configured
	 * @throws {Error} If custom provider test is not implemented (default behavior)
	 * @throws {ai.AISDKError} If the model request fails
	 *
	 * @see {@link getProviderTimeoutMs} for timeout configuration
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
	 * Provides the list of available language models for this provider.
	 *
	 * This method is called by VS Code's language model system to discover which
	 * models are available from this provider. It uses cached model information
	 * if available, otherwise resolves models using {@link resolveModels} and
	 * applies filters.
	 *
	 * @param options - Options controlling the information retrieval
	 * @param options.silent - If true, suppresses error notifications
	 * @param token - Cancellation token for aborting the operation
	 * @returns A promise that resolves to an array of available model descriptors
	 *
	 * @see {@link resolveModels} for model resolution logic
	 * @see {@link filterModels} for model filtering
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
	 * Provides a chat response from the language model.
	 *
	 * This is the main entry point for handling chat interactions with the AI model.
	 * The method routes to either {@link provideVercelResponse} for Vercel AI SDK
	 * providers or {@link provideCustomResponse} for custom implementations.
	 *
	 * The response is streamed incrementally through the progress reporter, allowing
	 * UI to update as tokens are received. Supports both text responses and tool calls.
	 *
	 * @param model - Information about the model to use for the response
	 * @param messages - Array of chat messages representing the conversation history
	 * @param options - Options controlling the response generation (tools, model parameters, etc.)
	 * @param progress - Progress reporter for streaming response parts back to the caller
	 * @param token - Cancellation token to abort the request
	 * @returns A promise that resolves when the response is complete
	 *
	 * @throws {Error} If no provider is configured (neither Vercel nor custom)
	 *
	 * @see {@link provideVercelResponse} for Vercel AI SDK implementation
	 * @see {@link provideCustomResponse} for custom provider implementation
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
	 * Provides a chat response using the Vercel AI SDK.
	 *
	 * This is the default implementation for Vercel AI SDK-based providers. It:
	 * 1. Processes and validates messages
	 * 2. Converts messages to Vercel AI format
	 * 3. Sets up tools if provided
	 * 4. Streams the response using {@link ai.streamText}
	 * 5. Handles response parts (text, tool calls, errors)
	 * 6. Tracks token usage
	 *
	 * Special handling is included for:
	 * - Anthropic models: Support for experimental_content in tool results
	 * - Bedrock models: Cache breakpoint support
	 * - System prompts: Injected from modelOptions.system
	 *
	 * @param model - Information about the model to use
	 * @param messages - Conversation history to send to the model
	 * @param options - Generation options including tools and model parameters
	 * @param progress - Progress reporter for streaming response parts
	 * @param token - Cancellation token to abort the request
	 * @returns A promise that resolves when streaming is complete
	 *
	 * @throws {Error} If AI provider is not configured
	 *
	 * @see {@link handleStreamResponse} for response streaming logic
	 * @see {@link setupTools} for tool configuration
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
			tools = this.setupTools([...options.tools]); // Convert readonly array to mutable
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
	 * Provides a chat response using a custom (non-Vercel AI SDK) provider implementation.
	 *
	 * Override this method in subclasses that use custom provider implementations
	 * instead of the Vercel AI SDK. This allows providers to implement their own
	 * request/response handling logic while still benefiting from the common
	 * ModelProvider infrastructure.
	 *
	 * @param model - Information about the model to use
	 * @param messages - Conversation history to send to the model
	 * @param options - Generation options including tools and model parameters
	 * @param progress - Progress reporter for streaming response parts
	 * @param token - Cancellation token to abort the request
	 * @returns A promise that resolves when the response is complete
	 *
	 * @throws {Error} Default implementation throws an error prompting to override
	 *
	 * @example
	 * ```typescript
	 * protected async provideCustomResponse(model, messages, options, progress, token) {
	 *   const response = await this.customProvider.chat(messages);
	 *   for (const chunk of response) {
	 *     progress.report(new vscode.LanguageModelTextPart(chunk));
	 *   }
	 * }
	 * ```
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
	 * Sets up tools (function calling) for the chat request.
	 *
	 * Converts VS Code language model tools to Vercel AI SDK tool format.
	 * Ensures all tool schemas have proper type information, defaulting to
	 * 'object' if not specified (required by some providers).
	 *
	 * @param tools - Array of VS Code language model chat tools to configure
	 * @returns A record mapping tool names to Vercel AI SDK tool definitions
	 *
	 * @see {@link ai.tool} for Vercel AI SDK tool format
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
	 * This method processes the stream from {@link ai.streamText}, handling different
	 * part types (text, reasoning, tool calls, errors) and reporting them through
	 * the progress reporter. It also:
	 * - Accumulates text deltas for more efficient logging
	 * - Flushes accumulated deltas when non-text parts are received
	 * - Handles warnings from the model
	 * - Tracks and reports token usage
	 * - Respects cancellation tokens
	 *
	 * @param result - The streaming result from {@link ai.streamText}
	 * @param model - Information about the model being used
	 * @param progress - Progress reporter for sending response parts to the caller
	 * @param token - Cancellation token to abort streaming
	 * @param requestId - Optional request ID for tracking and logging
	 * @returns A promise that resolves when streaming is complete
	 *
	 * @throws {Error} If an error part is received in the stream
	 *
	 * @see {@link handleTokenUsage} for token usage tracking
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
	 * Extracts token usage information from the AI result and:
	 * - Tracks input, output, and cached tokens
	 * - Handles provider-specific usage metadata (e.g., Bedrock cache tokens)
	 * - Records usage in request tracking and extension storage
	 * - Logs usage information for debugging
	 *
	 * @param result - The AI result containing usage information
	 * @param model - Information about the model that was used
	 * @param requestId - Optional request ID for tracking this specific request
	 * @returns A promise that resolves when usage tracking is complete
	 *
	 * @see {@link recordRequestTokenUsage} for request-specific tracking
	 * @see {@link recordTokenUsage} for persistent storage
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
	 * Provides an estimated token count for the given text or messages.
	 *
	 * This is a naive approximation that assumes approximately 4 characters per token.
	 * For more accurate token counting, subclasses should override this method to use
	 * model-specific tokenizers (e.g., tiktoken for OpenAI models, Anthropic's tokenizer
	 * for Claude).
	 *
	 * @param model - Information about the model (for model-specific tokenization)
	 * @param text - The text or message to count tokens for
	 * @param token - Cancellation token (currently unused)
	 * @returns A promise that resolves to the estimated token count
	 *
	 * @todo Implement model-specific tokenizers for accurate token counting
	 *
	 * @example
	 * ```typescript
	 * const count = await provider.provideTokenCount(model, 'Hello world', token);
	 * console.log(`Estimated tokens: ${count}`); // ~3 tokens
	 * ```
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
	 * This method handles common error types across providers:
	 * - Authorization errors (401/403): Throws {@link AuthenticationError}
	 * - API call errors: Extracts error messages from response bodies
	 *
	 * Subclasses can override this method to add provider-specific error handling.
	 *
	 * @param error - The error object returned by the provider
	 * @returns A promise that resolves to a user-friendly error message, or undefined
	 *          if the error wasn't specifically handled
	 *
	 * @throws {AuthenticationError} If the error is an authorization error
	 *
	 * @see {@link isAuthorizationError} for authorization error detection
	 * @see {@link ai.APICallError} for Vercel AI SDK error types
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
	 * Resolves the available language models for this provider.
	 *
	 * This method attempts to discover available models through multiple strategies
	 * in the following order:
	 * 1. Configuration-based models: Uses {@link retrieveModelsFromConfig} to check for
	 *    explicitly configured models
	 * 2. API-based models: Uses {@link retrieveModelsFromApi} to fetch models from the
	 *    provider's API
	 * 3. Default model: Falls back to {@link createDefaultModel} if no other models are
	 *    available
	 *
	 * The resolved models are cached in {@link modelListing} for future use.
	 *
	 * @param token - Cancellation token for aborting the resolution process
	 * @returns A promise that resolves to an array of available model descriptors
	 *
	 * @see {@link retrieveModelsFromConfig} for configuration-based retrieval
	 * @see {@link retrieveModelsFromApi} for API-based retrieval
	 * @see {@link createDefaultModel} for fallback model creation
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
	 * Retrieves models from user configuration.
	 *
	 * Checks for models defined in the extension's configuration settings
	 * (e.g., via modelDefinitions). This allows users to explicitly specify
	 * which models they want to use with this provider.
	 *
	 * If configured models are found, they are converted to
	 * {@link vscode.LanguageModelChatInformation} format with their specified
	 * token limits and marked with a default model if configured.
	 *
	 * @returns An array of configured models, or undefined if no models are configured
	 *
	 * @see {@link getAllModelDefinitions} for retrieving model definitions
	 * @see {@link createModelInfo} for model information creation
	 * @see {@link markDefaultModel} for default model selection
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
	 *
	 * This method should be overridden by subclasses that support dynamic model
	 * discovery via API. The default implementation returns undefined. Providers
	 * like OpenAI that offer a models API endpoint should override this to fetch
	 * and return available models.
	 *
	 * @param token - Cancellation token for aborting the API request
	 * @returns A promise that resolves to an array of models from the API, or undefined
	 *          if API-based model retrieval is not supported
	 *
	 * @example
	 * ```typescript
	 * protected async retrieveModelsFromApi(token: vscode.CancellationToken) {
	 *   const response = await fetch(`${this.baseUrl}/models`);
	 *   const data = await response.json();
	 *   return data.models.map(m => createModelInfo({ id: m.id, name: m.name, ... }));
	 * }
	 * ```
	 */
	protected async retrieveModelsFromApi(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		// Default implementation - override in subclasses
		return undefined;
	}

	/**
	 * Creates a default model when no other models are available.
	 *
	 * This method is called as a last resort when:
	 * - No models are configured in settings
	 * - The provider's API doesn't return any models
	 * - API-based model retrieval is not supported
	 *
	 * It creates a single model using the provider's configured model ID and
	 * marks it as the default model.
	 *
	 * @returns An array containing a single default model descriptor
	 *
	 * @see {@link createModelInfo} for model information creation
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
	 * Handles authentication errors in a consistent way across providers.
	 *
	 * This utility method extracts the error message and logs it, then returns
	 * a user-friendly message with guidance to check credentials. Subclasses
	 * can override this for provider-specific authentication error handling.
	 *
	 * @param error - The authentication error to handle
	 * @returns A user-friendly error message with guidance for resolution
	 */
	protected handleAuthenticationError(error: any): string {
		const message = error.message || 'Authentication failed';
		this.logger.error(`Authentication error: ${message}`);
		return `${message}. Please check your credentials and try signing in again.`;
	}

	/**
	 * Autoconfigures the language model provider, if supported.
	 *
	 * This static method is called to attempt automatic configuration of the provider,
	 * typically by checking for environment variables (e.g., ANTHROPIC_API_KEY) or
	 * other system-provided credentials. Not all providers support autoconfiguration.
	 *
	 * Implementations should:
	 * - Check for available credentials in environment or system
	 * - Validate the credentials if found
	 * - Return success status and optional configuration message
	 *
	 * @returns A promise that resolves to the autoconfigure result indicating success
	 *          or failure and any relevant messages
	 *
	 * @example
	 * ```typescript
	 * static autoconfigure = async (): Promise<AutoconfigureResult> => {
	 *   const apiKey = process.env.ANTHROPIC_API_KEY;
	 *   if (apiKey && apiKey.startsWith('sk-ant-')) {
	 *     return { configured: true, message: 'Found API key in environment' };
	 *   }
	 *   return { configured: false, message: 'No API key found' };
	 * };
	 * ```
	 */
	static autoconfigure?: () => Promise<AutoconfigureResult>;
}
