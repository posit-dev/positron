/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { ModelConfig, SecretStorage, getMaxConnectionAttempts } from '../../config';
import { isAuthorizationError } from '../../utils';
import { applyModelFilters } from '../../modelFilters';
import { getAllModelDefinitions } from '../../modelDefinitions';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT, DEFAULT_MODEL_CAPABILITIES } from '../../constants';
import { ModelProviderLogger } from './modelProviderLogger';
import { AuthenticationError, ModelRetrievalError } from './modelProviderErrors';
import { AutoconfigureResult, ModelCapabilities } from './modelProviderTypes';

/**
 * Abstract base class for all model providers in the Positron Assistant extension.
 *
 * This class provides a universal interface for interacting with various AI model providers
 * (Anthropic, OpenAI, Google, Azure, etc.) through a consistent API. It implements the
 * {@link positron.ai.LanguageModelChatProvider} interface to integrate with Positron's
 * language model system.
 *
 * This base class is provider-agnostic and can support ANY provider implementation:
 * - Vercel AI SDK providers (via {@link VercelModelProvider})
 * - Custom SDK providers (direct implementation)
 * - Hybrid providers (custom auth + Vercel chat)
 *
 * Key responsibilities:
 * - Connection resolution with retry logic and timeout handling
 * - Model discovery and filtering based on capabilities and configuration
 * - Credential validation and authentication error handling
 * - Token counting interface
 * - Provider-specific error parsing
 *
 * Subclasses must implement:
 * - {@link provideLanguageModelChatResponse} - Chat response generation
 * - {@link sendTestMessage} - Connection testing
 * - {@link initializeProvider} - Provider initialization (optional)
 *
 * @example
 * ```typescript
 * class MyCustomProvider extends ModelProvider {
 *   get providerName(): string {
 *     return 'My Provider';
 *   }
 *
 *   protected initializeProvider() {
 *     // Initialize your custom SDK
 *   }
 *
 *   async provideLanguageModelChatResponse(...) {
 *     // Implement custom chat logic
 *   }
 *
 *   protected async sendTestMessage(modelId: string) {
 *     // Implement custom test logic
 *   }
 * }
 * ```
 *
 * @see {@link VercelModelProvider} for Vercel AI SDK providers
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
	public readonly displayName: string;

	/**
	 * Provider ID (e.g., 'anthropic-api', 'openai-api', 'ollama').
	 */
	public readonly providerId: string;

	/**
	 * Unique identifier for this model configuration.
	 */
	public readonly id: string;

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
	capabilities: ModelCapabilities = DEFAULT_MODEL_CAPABILITIES;

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
		this.displayName = _config.name;
		this.providerId = _config.provider;
		this.logger = new ModelProviderLogger(this.providerName);
		this.initializeProvider();
	}

	/**
	 * Optional provider-specific initialization hook.
	 * Override this method in subclasses to set up the AI provider instance.
	 * Called automatically during construction after logger initialization.
	 * @protected
	 */
	protected initializeProvider(): void {
		// Default implementation does nothing - subclasses override as needed
	}

	/**
	 * Gets the human-readable display name of the provider.
	 *
	 * This name is used in UI elements and log messages to identify the provider.
	 * The default implementation returns the displayName from the static source property.
	 * Subclasses can override this if they need custom logic.
	 *
	 * @returns The display name of the provider (e.g., 'Anthropic', 'OpenAI', 'Ollama')
	 */
	get providerName() {
		return (this.constructor as typeof ModelProvider).source.provider.displayName;
	}

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
		return applyModelFilters(models, this.providerId, this.providerName);
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
	 * Subclasses must implement this method to test connectivity with their specific
	 * provider SDK. The test message should be kept simple to minimize token usage
	 * while still verifying end-to-end connectivity.
	 *
	 * @param modelId - The ID of the model to test
	 * @returns A promise that resolves to the test response from the model
	 *
	 * @throws {Error} If the model request fails
	 *
	 * @example
	 * ```typescript
	 * // Vercel AI SDK provider (implemented in VercelModelProvider subclass)
	 * protected async sendTestMessage(modelId: string) {
	 *   return ai.generateText({
	 *     model: this.createAIProvider()(modelId),
	 *     prompt: "Hello",
	 *     maxRetries: 1,
	 *   });
	 * }
	 *
	 * // Custom provider using native SDK
	 * protected async sendTestMessage(modelId: string) {
	 *   return this._client.chat({ model: modelId, messages: [{ role: 'user', content: 'Hello' }] });
	 * }
	 * ```
	 *
	 * @see {@link getProviderTimeoutMs} for timeout configuration
	 */
	protected abstract sendTestMessage(modelId: string): Promise<any>;

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
	 * Subclasses must implement this method to provide chat responses using their
	 * specific provider SDK.
	 *
	 * The response should be streamed incrementally through the progress reporter,
	 * allowing UI to update as tokens are received. Should support both text responses
	 * and tool calls.
	 *
	 * @param model - Information about the model to use for the response
	 * @param messages - Array of chat messages representing the conversation history
	 * @param options - Options controlling the response generation (tools, model parameters, etc.)
	 * @param progress - Progress reporter for streaming response parts back to the caller
	 * @param token - Cancellation token to abort the request
	 * @returns A promise that resolves when the response is complete
	 *
	 * @example
	 * ```typescript
	 * async provideLanguageModelChatResponse(model, messages, options, progress, token) {
	 *   const stream = await this._client.chat.stream({
	 *     model: model.id,
	 *     messages: convertMessages(messages),
	 *   });
	 *
	 *   for await (const chunk of stream) {
	 *     progress.report(new vscode.LanguageModelTextPart(chunk.text));
	 *   }
	 * }
	 * ```
	 */
	abstract provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void>;


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
		if (defaultModel) {
			this.modelListing = defaultModel;
			return defaultModel;
		}
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
		const configuredModels = getAllModelDefinitions(this.providerId);
		if (configuredModels.length === 0) {
			return undefined;
		}

		this.logger.info(`Using ${configuredModels.length} configured models.`);

		const models: vscode.LanguageModelChatInformation[] = configuredModels.map(model =>
			createModelInfo({
				id: model.identifier,
				name: model.name,
				family: this.providerId,
				version: '1.0',
				provider: this.providerId,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: model.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT,
				defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
			})
		);

		return markDefaultModel(models, this.providerId, this._config.model);
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
	protected createDefaultModel(): vscode.LanguageModelChatInformation[] | undefined {
		this.logger.info('No models available.');
		return undefined;
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
