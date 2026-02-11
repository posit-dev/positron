/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as ai from 'ai';
import { ModelProvider } from './modelProvider';
import { CacheBreakpointProvider, processMessages, toAIMessage } from '../../utils';
import { getProviderTimeoutMs } from '../../config';
import { TokenUsage } from '../../tokens';
import { recordRequestTokenUsage, recordTokenUsage } from '../../extension';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { getAllModelDefinitions } from '../../modelDefinitions';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';
import { ErrorContext } from './errorContext';

/**
 * Base class for all Vercel AI SDK-based model providers.
 *
 * This class extends {@link ModelProvider} to add Vercel AI SDK-specific functionality,
 * providing a standardized way to integrate providers that use the Vercel AI SDK
 * (@ai-sdk/* packages) for chat completions.
 *
 * Key features provided by this class:
 * - Vercel AI SDK provider factory management
 * - Standardized chat response streaming via `ai.streamText()`
 * - Tool/function calling with automatic schema conversion
 * - Token usage tracking and reporting
 * - Connection testing via `ai.generateText()`
 *
 * Subclasses must implement:
 * - {@link initializeProvider} - Sets up the Vercel AI SDK provider
 * - {@link providerName} - Returns the display name
 *
 * @example
 * ```typescript
 * class MyVercelProvider extends VercelModelProvider {
 *   protected initializeProvider(): void {
 *     this.aiProvider = createMyProvider({ apiKey: this._config.apiKey });
 *   }
 *
 *   get providerName(): string {
 *     return 'My Provider';
 *   }
 * }
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://sdk.vercel.ai/docs for Vercel AI SDK documentation
 */
export abstract class VercelModelProvider extends ModelProvider {
	/**
	 * The AI provider factory from Vercel AI SDK.
	 * This function creates a language model instance given a model ID and optional configuration.
	 * Subclasses must set this in their {@link initializeProvider} method.
	 */
	protected aiProvider: (id: string, options?: Record<string, any>) => ai.LanguageModel;

	/**
	 * Additional options passed to the AI provider when creating model instances.
	 * Provider-specific options like temperature, top_p, etc.
	 */
	protected aiOptions: Record<string, any> = {};

	/**
	 * Whether this provider uses the older /v1/chat/completions endpoint,
	 * as opposed to the newer /v1/responses endpoint.
	 *
	 * This affects how certain features are handled, such as tool result
	 * formatting (e.g., image support).
	 */
	protected usesChatCompletions: boolean = false;

	/**
	 * Current error context for tracking where errors occur.
	 * Used to adjust error messages and notification behavior based on context.
	 */
	protected _errorContext: ErrorContext = {
		isConnectionTest: false,
		isChat: false,
		isStartup: false
	};


	/**
	 * Sends a test message to verify model connectivity.
	 *
	 * Uses Vercel AI SDK's `generateText` to send a simple test message
	 * with timeout and retry logic.
	 *
	 * @param modelId - The ID of the model to test
	 * @returns A promise that resolves to the test response
	 */
	protected override async sendTestMessage(modelId: string) {
		return ai.generateText({
			model: this.aiProvider(modelId, this.aiOptions),
			prompt: `I'm checking to see if you're there. Respond only with the word "hello".`,
			abortSignal: AbortSignal.timeout(getProviderTimeoutMs()),
			maxRetries: 1,
		});
	}

	/**
	 * Provides a chat response using the Vercel AI SDK.
	 *
	 * This method implements the standard Vercel AI SDK chat flow:
	 * 1. Process and validate messages
	 * 2. Convert messages to Vercel AI format
	 * 3. Set up tools if provided
	 * 4. Stream the response using {@link ai.streamText}
	 * 5. Handle response parts (text, tool calls, errors)
	 * 6. Track token usage
	 *
	 * @param model - Information about the model to use
	 * @param messages - Conversation history to send to the model
	 * @param options - Generation options including tools and model parameters
	 * @param progress - Progress reporter for streaming response parts
	 * @param token - Cancellation token to abort the request
	 * @returns A promise that resolves when streaming is complete
	 */
	override async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	) {
		return this.provideVercelResponse(model, messages, options, progress, token);
	}

	/**
	 * Provides a chat response using the Vercel AI SDK.
	 *
	 * This is the core implementation for Vercel AI SDK-based providers.
	 * Handles message processing, tool setup, streaming, and token usage tracking.
	 *
	 * @param model - Information about the model to use
	 * @param messages - Conversation history to send to the model
	 * @param options - Generation options including tools and model parameters
	 * @param progress - Progress reporter for streaming response parts
	 * @param token - Cancellation token to abort the request
	 * @returns A promise that resolves when streaming is complete
	 */
	protected async provideVercelResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken,
		providerOptions?: {
			toolResultExperimentalContent?: boolean;
			bedrockCacheBreakpoint?: boolean;
			anthropicCacheBreakpoint?: boolean;
		}
	): Promise<void> {
		const aiModel = this.aiProvider(model.id);
		const modelOptions = options.modelOptions ?? {};

		const controller = new AbortController();
		const signal = controller.signal;
		token.onCancellationRequested(() => controller.abort());

		let tools: Record<string, ai.Tool> | undefined;

		// Ensure all messages have content
		const processedMessages = processMessages(messages);

		// Add system prompt from modelOptions.system, if provided
		if (modelOptions.system) {
			processedMessages.unshift(new vscode.LanguageModelChatMessage(
				vscode.LanguageModelChatMessageRole.System,
				modelOptions.system
			));
		}

		// Extract provider-specific options
		const { bedrockCacheBreakpoint = false, anthropicCacheBreakpoint = false, toolResultExperimentalContent = false } = providerOptions || {};

		// Determine which cache breakpoint provider to use (if any)
		const cacheBreakpointProvider: CacheBreakpointProvider | undefined =
			bedrockCacheBreakpoint ? 'bedrock' :
				anthropicCacheBreakpoint ? 'anthropic' :
					undefined;

		// Convert all messages to the Vercel AI format
		const aiMessages: ai.ModelMessage[] = toAIMessage(
			processedMessages,
			this.usesChatCompletions,
			cacheBreakpointProvider
		);

		// Set up tools if provided
		if (options.tools && options.tools.length > 0) {
			tools = this.setupTools([...options.tools]); // Convert readonly array to mutable
		}

		const modelTools = this._config.toolCalls ? tools : undefined;
		const requestId = options.modelOptions?.requestId;

		this.logger.debug(`[vercel] Start request ${requestId} to ${model.name} [${model.id}]: ${aiMessages.length} messages`);
		this.logger.debug(`[${model.name}] SEND ${aiMessages.length} messages, ${modelTools ? Object.keys(modelTools).length : 0} tools`);

		// Stream the response
		const result = ai.streamText({
			model: aiModel,
			messages: aiMessages,
			tools: modelTools,
			abortSignal: signal,
		});

		await this.handleStreamResponse(result, model, progress, token, requestId);
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
	 */
	protected setupTools(tools: vscode.LanguageModelChatTool[]): Record<string, ai.Tool> {
		return tools.reduce((acc: Record<string, ai.Tool>, tool: vscode.LanguageModelChatTool) => {
			// Some providers require type, properties, and required for all tool input schemas
			const baseSchema = tool.inputSchema as Record<string, any> ?? {};
			const missingFields: string[] = [];

			if (!baseSchema.type) {
				missingFields.push('type');
			}
			if (!baseSchema.properties) {
				missingFields.push('properties');
			}
			if (!baseSchema.required) {
				missingFields.push('required');
			}

			if (missingFields.length > 0) {
				this.logger.trace(`Tool '${tool.name}' is missing input schema fields: ${missingFields.join(', ')}; using defaults`);
			}

			const input_schema: Record<string, any> = {
				...baseSchema,
				type: baseSchema.type ?? 'object',
				properties: baseSchema.properties ?? {},
				required: baseSchema.required ?? [],
			};

			acc[tool.name] = {
				description: tool.description || '',
				inputSchema: ai.jsonSchema(input_schema),
			};
			return acc;
		}, {});
	}

	/**
	 * Handles the streaming response from the AI model.
	 *
	 * Processes the stream from {@link ai.streamText}, handling different
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
	 */
	protected async handleStreamResponse(
		result: ReturnType<typeof ai.streamText>,
		model: vscode.LanguageModelChatInformation,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken,
		requestId?: string
	): Promise<void> {
		// Set chat context for error handling
		this._errorContext = {
			isConnectionTest: false,
			isChat: true,
			isStartup: false,
			requestId
		};

		let accumulatedTextDeltas: string[] = [];

		const flushAccumulatedTextDeltas = () => {
			if (accumulatedTextDeltas.length > 0) {
				const combinedText = accumulatedTextDeltas.join('');
				this.logger.trace(`[${model.name}] RECV text-delta (${accumulatedTextDeltas.length} parts): ${combinedText}`);
				accumulatedTextDeltas = [];
			}
		};

		try {
			for await (const part of result.fullStream) {
				if (token.isCancellationRequested) {
					break;
				}

				if (part.type === 'text-delta') {
					accumulatedTextDeltas.push(part.text);
					progress.report(new vscode.LanguageModelTextPart(part.text));
				}

				if (part.type === 'tool-call') {
					flushAccumulatedTextDeltas();
					this.logger.trace(`[${this._config.name}] RECV tool-call: ${part.toolCallId} (${part.toolName}) with input: ${JSON.stringify(part.input)}`);
					progress.report(new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, part.input));
				}

				if (part.type === 'error') {
					flushAccumulatedTextDeltas();
					this.logger.warn(`[${model.name}] RECV error`, part.error);
					const errorMsg = await this.parseProviderError(part.error, this._errorContext) ||
						(typeof part.error === 'string' ? part.error : JSON.stringify(part.error, null, 2));
					throw new Error(`[${model.name}] Error in chat response: ${errorMsg}`);
				}
			}
		} finally {
			// Reset error context after handling stream
			this._errorContext = { isConnectionTest: false, isChat: false, isStartup: false };
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
	 */
	protected async handleTokenUsage(
		result: ReturnType<typeof ai.streamText>,
		model: vscode.LanguageModelChatInformation,
		requestId?: string
	): Promise<void> {
		const usage = await result.usage;
		const metadata = await result.providerMetadata;
		const tokens: TokenUsage = {
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
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
			if (part.report) {
				part.report(part);
			}

			this.logger.debug(`[${model.name}]: Bedrock usage: ${JSON.stringify(usage, null, 2)}`);
		}

		// Handle Anthropic-specific usage (cache tokens are directly on metadata.anthropic, not nested under usage)
		if (metadata && metadata.anthropic) {
			const anthropicMeta = metadata.anthropic as Record<string, any>;
			tokens.inputTokens += anthropicMeta.cacheCreationInputTokens || anthropicMeta.usage?.cache_creation_input_tokens || 0;
			tokens.cachedTokens += anthropicMeta.cacheReadInputTokens || anthropicMeta.usage?.cache_read_input_tokens || 0;

			this.logger.debug(`[${model.name}]: Anthropic usage: ${JSON.stringify(anthropicMeta, null, 2)}`);
		}

		if (requestId) {
			recordRequestTokenUsage(requestId, this.providerId, tokens);
		}

		if (this._context) {
			recordTokenUsage(this._context, this.providerId, tokens);
		}

		this.logger.info(`[vercel]: End request ${requestId}; usage: ${tokens.inputTokens} input tokens (+${tokens.cachedTokens} cached), ${tokens.outputTokens} output tokens`);
	}

	/**
	 * Retrieves models from user configuration.
	 *
	 * Overrides the base implementation to extract version information from
	 * the Vercel AI SDK provider.
	 *
	 * @returns An array of configured models, or undefined if no models are configured
	 */
	protected override retrieveModelsFromConfig() {
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
				version: '',
				provider: this.providerId,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: model.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT,
				defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
			})
		);

		return markDefaultModel(models, this.providerId, this._config.model);
	}
}
