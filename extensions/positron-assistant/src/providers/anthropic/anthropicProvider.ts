/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from '../base/modelProvider';
import { getProviderTimeoutMs } from '../../providerConfig.js';
import { ModelConfig } from '../../configTypes.js';
import { isChatImagePart, isCacheBreakpointPart, parseCacheBreakpoint, processMessages, promptTsxPartToString } from '../../utils.js';
import { DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants.js';
import { log } from '../../log.js';
import { TokenUsage, recordTokenUsage, recordRequestTokenUsage } from '../../tokens.js';
import { getAllModelDefinitions } from '../../modelDefinitions.js';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers.js';
import { LanguageModelDataPartMimeType } from '../../types.js';
import { ModelProviderLogger } from '../base/modelProviderLogger.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';
import {
	DEFAULT_ANTHROPIC_MODEL_NAME,
	DEFAULT_ANTHROPIC_MODEL_MATCH,
	fetchAnthropicModelsFromApi,
	getAnthropicModelsFromConfig,
	handleNativeSdkRateLimitError
} from './anthropicModelUtils.js';

// Re-export for consumers that import from this file
export { DEFAULT_ANTHROPIC_MODEL_NAME, DEFAULT_ANTHROPIC_MODEL_MATCH };

/**
 * Options for controlling cache behavior in the Anthropic language model.
 */
export interface CacheControlOptions {
	/** Add a cache breakpoint to the system prompt (default: true). */
	system?: boolean;
}

/**
 * Block params that set cache breakpoints.
 */
type CacheControllableBlockParam = Anthropic.TextBlockParam |
	Anthropic.ImageBlockParam |
	Anthropic.ToolUseBlockParam |
	Anthropic.ToolResultBlockParam;

/**
 * Anthropic Claude model provider implementation using native SDK.
 *
 * This provider integrates Anthropic's Claude models using the native `@anthropic-ai/sdk`
 * package directly (not through Vercel AI SDK). It provides more control and supports
 * Anthropic-specific features:
 * - All Claude model variants
 * - Vision capabilities (image inputs)
 * - Tool/function calling
 * - Streaming responses with request IDs
 * - Prompt caching with detailed control
 * - Native token counting via Anthropic SDK
 *
 * **Configuration:**
 * - Provider ID: `anthropic-api` (not `anthropic` which is used by Copilot Chat)
 * - Required: API key from Anthropic Console
 * - Optional: Model selection, tool calling toggle
 * - Supports: Environment variable autoconfiguration (ANTHROPIC_API_KEY)
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://docs.anthropic.com/ for Anthropic API documentation
 */
export class AnthropicModelProvider extends ModelProvider implements positron.ai.LanguageModelChatProvider {
	private readonly _client: Anthropic;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.anthropic,
		supportedOptions: ['apiKey', 'autoconfigure'],
		defaults: {
			name: DEFAULT_ANTHROPIC_MODEL_NAME,
			model: DEFAULT_ANTHROPIC_MODEL_MATCH + '-latest',
			toolCalls: true,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.EnvVariable, key: 'ANTHROPIC_API_KEY', signedIn: false }
		},
	};

	constructor(
		_config: ModelConfig,
		_context?: vscode.ExtensionContext,
		client?: Anthropic, // For testing only - production uses constructor initialization
	) {
		super(_config, _context);
		this._client = client ?? new Anthropic({ apiKey: _config.apiKey });
	}

	protected override async validateCredentials() {
		// Validate Anthropic API key format
		return !!this._config.apiKey && this._config.apiKey.startsWith('sk-ant-');
	}

	protected override getDefaultMatch(): string {
		return DEFAULT_ANTHROPIC_MODEL_MATCH;
	}

	override async resolveConnection(token: vscode.CancellationToken) {
		// Keep custom implementation for API-specific connection testing
		const timeoutMs = getProviderTimeoutMs();
		try {
			await this._client.withOptions({ timeout: timeoutMs }).models.list();
		} catch (error) {
			return error as Error;
		}
	}

	/**
	 * Sends a test message to verify model connectivity.
	 * Uses the native Anthropic SDK to test the connection.
	 */
	protected override async sendTestMessage(modelId: string) {
		return this._client.messages.create({
			model: modelId,
			max_tokens: 10,
			messages: [{ role: 'user', content: 'Hello' }]
		});
	}

	protected override retrieveModelsFromConfig() {
		return getAnthropicModelsFromConfig(
			this.providerId,
			this.providerName,
			this.capabilities,
			this.logger
		);
	}

	protected override async retrieveModelsFromApi(_token: vscode.CancellationToken) {
		return fetchAnthropicModelsFromApi(
			this._client,
			this.providerId,
			this.providerName,
			this.capabilities,
			this.logger
		);
	}

	override async provideLanguageModelChatResponse(
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
		const system = toAnthropicSystem(systemMessages, cacheControlOptions?.system, options.modelOptions?.system, this.logger);

		// Convert the remaining messages into anthropic user and assistant messages.
		const anthropicMessages = toAnthropicMessages(otherMessages);

		const body: Anthropic.MessageStreamParams = {
			model: model.id,
			max_tokens: options.modelOptions?.maxTokens ?? (this._config.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT),
			tools,
			tool_choice,
			system,
			messages: anthropicMessages,
		};

		const stream = this._client.messages.stream(body);

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
				// This can happen if the API key was not persisted correctly.
				if (error.message.startsWith('Could not resolve authentication method')) {
					throw new Error(`[${this.providerName}] Something went wrong when storing the Anthropic API key. ` +
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

	override async parseProviderError(error: any) {
		if (error instanceof Anthropic.APIError) {
			// Handle Anthropic-specific errors
			try {
				const data = JSON.parse(error.message);
				if (data?.error?.type === 'overloaded_error') {
					return `API is temporarily overloaded.`;
				}
			} catch { /* ignore */ }
		} else if (error instanceof Anthropic.AnthropicError) {
			if (error.message.startsWith('Could not resolve authentication method')) {
				return `Something went wrong when storing the Anthropic API key. Please delete and recreate the model configuration.`;
			}
		}
		return super.parseProviderError(error); // Delegate to base class
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

	override async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatMessage2, token: vscode.CancellationToken) {
		const messages: Anthropic.MessageParam[] = [];
		if (typeof text === 'string') {
			// For empty string, return 0 tokens
			if (text.trim() === '') {
				return 0;
			}
			// Otherwise, treat it as a user message
			messages.push({
				role: 'user',
				content: [
					{
						type: 'text',
						text,
					},
				],
			});
		} else {
			// For LanguageModelChatMessage, ensure it has non-empty message content
			messages.push(...toAnthropicMessages([text]));
			if (messages.length === 0) {
				return 0;
			}
		}
		const result = await this._client.messages.countTokens({
			model: model.id,
			messages,
		});
		return result.input_tokens;
	}
}

export function toTokenUsage(usage: Anthropic.MessageDeltaUsage): TokenUsage {
	const input = usage.input_tokens || 0;
	const output = usage.output_tokens || 0;
	const cache_creation = usage.cache_creation_input_tokens || 0;
	const cache_read = usage.cache_read_input_tokens || 0;

	return {
		inputTokens: input + cache_creation,
		outputTokens: output,
		cachedTokens: cache_read,
		providerMetadata: {
			anthropic: usage,
		}
	};
}

export function toAnthropicMessages(messages: vscode.LanguageModelChatMessage2[]): Anthropic.MessageParam[] {
	let userMessageIndex = 0;
	let assistantMessageIndex = 0;
	const anthropicMessages = processMessages(messages).map((message) => {
		const source = message.role === vscode.LanguageModelChatMessageRole.User ?
			`User message ${userMessageIndex++}` :
			`Assistant message ${assistantMessageIndex++}`;
		return toAnthropicMessage(message, source);
	});
	return anthropicMessages;
}

function toAnthropicMessage(message: vscode.LanguageModelChatMessage2, source: string): Anthropic.MessageParam {
	switch (message.role) {
		case vscode.LanguageModelChatMessageRole.Assistant:
			return toAnthropicAssistantMessage(message, source);
		case vscode.LanguageModelChatMessageRole.User:
			return toAnthropicUserMessage(message, source);
		default:
			// System messages should be filtered and instead handled elsewhere.
			throw new Error(`[Anthropic] Unsupported message role: ${message.role}`);
	}
}

function toAnthropicAssistantMessage(message: vscode.LanguageModelChatMessage2, source: string): Anthropic.MessageParam {
	const content: Anthropic.ContentBlockParam[] = [];
	for (let i = 0; i < message.content.length; i++) {
		const [part, nextPart] = [message.content[i], message.content[i + 1]];
		const dataPart = nextPart instanceof vscode.LanguageModelDataPart ? nextPart : undefined;
		if (part instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(part, source, dataPart));
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			content.push(toAnthropicToolUseBlock(part, source, dataPart));
		} else if (part instanceof vscode.LanguageModelDataPart) {
			// Skip extra data parts. They're handled in part conversion.
		} else {
			throw new Error('[Anthropic] Unsupported part type on assistant message');
		}
	}
	return {
		role: 'assistant',
		content,
	};
}

function toAnthropicUserMessage(message: vscode.LanguageModelChatMessage2, source: string): Anthropic.MessageParam {
	const content: Anthropic.ContentBlockParam[] = [];
	for (let i = 0; i < message.content.length; i++) {
		const [part, nextPart] = [message.content[i], message.content[i + 1]];
		const dataPart = nextPart instanceof vscode.LanguageModelDataPart ? nextPart : undefined;
		if (part instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(part, source, dataPart));
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			content.push(toAnthropicToolResultBlock(part, source, dataPart));
		} else if (part instanceof vscode.LanguageModelToolResultPart2) {
			content.push(toAnthropicToolResultBlock(part, source, dataPart));
		} else if (part instanceof vscode.LanguageModelDataPart) {
			if (isChatImagePart(part)) {
				content.push(chatImagePartToAnthropicImageBlock(part, source, dataPart));
			} else {
				// Skip other data parts.
				if (part.mimeType !== LanguageModelDataPartMimeType.CacheControl) {
					log.debug(`Skipping unsupported part in user message: ${JSON.stringify(part, null, 2)}`);
				}
			}
		} else {
			throw new Error(`[Anthropic] Unsupported part type on user message: ${JSON.stringify(part, null, 2)}`);
		}
	}
	return {
		role: 'user',
		content,
	};
}

function toAnthropicTextBlock(
	part: vscode.LanguageModelTextPart,
	source: string,
	dataPart?: vscode.LanguageModelDataPart,
): Anthropic.TextBlockParam {
	return withCacheControl(
		{
			type: 'text',
			text: part.value,
		},
		source,
		dataPart,
	);
}

function toAnthropicToolUseBlock(
	part: vscode.LanguageModelToolCallPart,
	source: string,
	dataPart?: vscode.LanguageModelDataPart,
): Anthropic.ToolUseBlockParam {
	return withCacheControl(
		{
			type: 'tool_use',
			id: part.callId,
			name: part.name,
			input: part.input,
		},
		source,
		dataPart,
	);
}

function toAnthropicToolResultBlock(
	part: vscode.LanguageModelToolResultPart,
	source: string,
	dataPart?: vscode.LanguageModelDataPart,
): Anthropic.ToolResultBlockParam {
	const content: Anthropic.ToolResultBlockParam['content'] = [];
	for (let i = 0; i < part.content.length; i++) {
		const [resultPart, resultNextPart] = [part.content[i], part.content[i + 1]];
		const resultDataPart = resultNextPart instanceof vscode.LanguageModelDataPart ? resultNextPart : undefined;
		if (resultPart instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(resultPart, source, resultDataPart));
		} else if (resultPart instanceof vscode.LanguageModelDataPart) {
			if (isChatImagePart(resultPart)) {
				content.push(chatImagePartToAnthropicImageBlock(resultPart, source, resultDataPart));
			} else {
				// Skip other data parts.
				log.debug(`Skipping unsupported data part in tool result: ${JSON.stringify(resultPart, null, 2)}`);
			}
		} else if (resultPart instanceof vscode.LanguageModelPromptTsxPart) {
			content.push(languageModelPromptTsxPartToAnthropicBlock(resultPart, source, resultDataPart));
		} else {
			throw new Error(`[Anthropic] Unsupported part type on tool result part content: ${JSON.stringify(resultPart)}`);
		}
	}
	return withCacheControl(
		{
			type: 'tool_result',
			tool_use_id: part.callId,
			content,
		},
		source,
		dataPart,
	);
}

function chatImagePartToAnthropicImageBlock(
	part: vscode.LanguageModelDataPart,
	source: string,
	dataPart?: vscode.LanguageModelDataPart,
): Anthropic.ImageBlockParam {
	return withCacheControl(
		{
			type: 'image',
			source: {
				type: 'base64',
				// We may pass an unsupported mime type; let Anthropic throw the error.
				media_type: part.mimeType as Anthropic.Base64ImageSource['media_type'],
				data: Buffer.from(part.data).toString('base64'),
			},
		},
		source,
		dataPart,
	);
}

function languageModelPromptTsxPartToAnthropicBlock(
	part: vscode.LanguageModelPromptTsxPart,
	source: string,
	dataPart?: vscode.LanguageModelDataPart,
): Anthropic.TextBlockParam {
	// Convert the prompt TSX part to a string representation using the shared utility
	const text = promptTsxPartToString(part);

	return withCacheControl(
		{
			type: 'text',
			text,
		},
		source,
		dataPart,
	);
}

export function toAnthropicTools(tools: readonly vscode.LanguageModelChatTool[]): Anthropic.ToolUnion[] {
	if (tools.length === 0) {
		return [];
	}
	const anthropicTools = tools.map(tool => toAnthropicTool(tool));

	// Ensure a stable sort order for prompt caching.
	anthropicTools.sort((a, b) => a.name.localeCompare(b.name));

	return anthropicTools;
}

function toAnthropicTool(tool: vscode.LanguageModelChatTool): Anthropic.ToolUnion {
	// Anthropic requires a type for all tools; default to 'object' if not provided.
	const input_schema = tool.inputSchema as Anthropic.Tool.InputSchema ?? {
		type: 'object',
		properties: {},
		required: []
	};
	if (!input_schema.type) {
		log.warn(`Tool '${tool.name}' is missing input schema type; defaulting to 'object'`);
		input_schema.type = 'object';
	}
	return {
		name: tool.name,
		description: tool.description,
		input_schema,
	};
}

export function toAnthropicToolChoice(toolMode: vscode.LanguageModelChatToolMode): Anthropic.ToolChoice | undefined {
	switch (toolMode) {
		case vscode.LanguageModelChatToolMode.Auto:
			return {
				type: 'auto',
			};
		case vscode.LanguageModelChatToolMode.Required:
			return {
				type: 'any',
			};
		default:
			// Should not happen.
			throw new Error(`[Anthropic] Unsupported tool mode: ${toolMode}`);
	}
}

/**
 * Convert a set of system messages into an anthropic system prompt.
 */
export function toAnthropicSystem(
	messages: vscode.LanguageModelChatMessage2[],
	cacheSystem = true,
	system?: string | vscode.LanguageModelTextPart[],
	logger?: ModelProviderLogger
): Anthropic.MessageCreateParams['system'] {
	// Append system prompt from `modelOptions.system`, if provided.
	// TODO: Once extensions such as databot no longer use `modelOptions.system`,
	// we can remove the `system` parameter and use the given system messages only.
	if (system) {
		messages.push(
			new vscode.LanguageModelChatMessage2(vscode.LanguageModelChatMessageRole.System, system)
		);
	}

	// Convert each system message to anthropic text blocks
	const anthropicSystem = messages.flatMap((message, idx) => {
		return toAnthropicSystemParts(message, `System message ${idx}`);
	});

	if (anthropicSystem.length === 0) {
		return undefined;
	} else if (cacheSystem) {
		// Add a cache breakpoint to the last system prompt block.
		const lastSystemBlock = anthropicSystem[anthropicSystem.length - 1];
		lastSystemBlock.cache_control = { type: 'ephemeral' };
		logger?.debug(`Adding cache breakpoint to system prompt`);
	}

	return anthropicSystem;
}

function toAnthropicSystemParts(message: vscode.LanguageModelChatMessage2, source: string): Anthropic.TextBlockParam[] {
	const content: Anthropic.TextBlockParam[] = [];
	for (let i = 0; i < message.content.length; i++) {
		const part = message.content[i];
		if (part instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(part, source));
		} else if (part instanceof vscode.LanguageModelPromptTsxPart) {
			content.push(languageModelPromptTsxPartToAnthropicBlock(part, source));
		} else {
			throw new Error('[Anthropic] Unsupported part type on system message');
		}
	}
	return content;
}

export function isCacheControlOptions(options: unknown): options is CacheControlOptions {
	if (typeof options !== 'object' || options === null) {
		return false;
	}
	const cacheControlOptions = options as CacheControlOptions;
	return cacheControlOptions.system === undefined || typeof cacheControlOptions.system === 'boolean';
}

function withCacheControl<T extends CacheControllableBlockParam>(
	part: T,
	source: string,
	dataPart: vscode.LanguageModelDataPart | undefined,
): T {
	if (!isCacheBreakpointPart(dataPart)) {
		return part;
	}

	try {
		const cacheBreakpoint = parseCacheBreakpoint(dataPart);
		// Cache control added
		log.debug(`Adding cache breakpoint to ${part.type} part. Source: ${source}`);
		return {
			...part,
			cache_control: cacheBreakpoint,
		};
	} catch (error) {
		// Failed to parse cache breakpoint
		log.error(`Failed to parse cache breakpoint: ${error}`);

		return part;
	}
}
