/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { ModelConfig } from './config';
import { isLanguageModelImagePart, LanguageModelImagePart } from './languageModelParts.js';
import { isChatImagePart, isCacheBreakpointPart, parseCacheBreakpoint, processMessages, promptTsxPartToString } from './utils.js';
import { DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { log, recordTokenUsage, recordRequestTokenUsage } from './extension.js';
import { availableModels } from './models.js';
import { TokenUsage } from './tokens.js';

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

export class AnthropicLanguageModel implements positron.ai.LanguageModelChatProvider2 {
	name: string;
	provider: string;
	family: string;
	id: string;
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	tokenCount: number = 0;

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	private readonly _client: Anthropic;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			// Note: The 'anthropic' provider name is taken by Copilot Chat; we
			// use 'anthropic-api' instead to make it possible to differentiate
			// the two.
			id: 'anthropic-api',
			displayName: 'Anthropic'
		},
		supportedOptions: ['apiKey', 'apiKeyEnvVar'],
		defaults: {
			name: 'Claude 3.5 Sonnet v2',
			model: 'claude-3-5-sonnet-latest',
			toolCalls: true,
			apiKeyEnvVar: { key: 'ANTHROPIC_API_KEY', signedIn: false },
		},
	};

	constructor(
		private readonly _config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext,
		client?: Anthropic,
	) {
		this.name = _config.name;
		this.family = this.provider = _config.provider;
		this.id = _config.id;
		this._client = client ?? new Anthropic({
			apiKey: _config.apiKey,
		});
		this.version = '';
		this.maxInputTokens = 0;
		this.maxOutputTokens = _config.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT;
	}

	async prepareLanguageModelChat(options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const models = availableModels.get(this.provider);

		if (!models || models.length === 0) {
			return [
				{
					id: this.id,
					name: this.name,
					family: this.provider,
					version: this._context?.extension.packageJSON.version ?? '',
					maxInputTokens: 0,
					maxOutputTokens: this.maxOutputTokens,
					capabilities: this.capabilities,

				}
			];
		}

		const languageModels: vscode.LanguageModelChatInformation[] = models.map(model => ({
			id: model.identifier,
			name: model.name,
			family: this._config.provider,
			version: model.identifier, // 1.103.0 TODO: is there a better value? this may vary between providers
			maxInputTokens: this.maxInputTokens,
			maxOutputTokens: this.maxOutputTokens,
			capabilities: this.capabilities,
			isDefault: model === models[0],
			isUserSelectable: true,
		}));

		return languageModels;
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.LanguageModelChatRequestOptions,
		progress: vscode.Progress<vscode.ChatResponseFragment2>,
		token: vscode.CancellationToken
	) {
		const cacheControlOptions = isCacheControlOptions(options.modelOptions?.cacheControl)
			? options.modelOptions.cacheControl
			: undefined;
		const tools = options.tools && toAnthropicTools(options.tools);
		const tool_choice = options.toolMode && toAnthropicToolChoice(options.toolMode);
		const system = options.modelOptions?.system &&
			toAnthropicSystem(options.modelOptions.system, cacheControlOptions?.system);
		const anthropicMessages = toAnthropicMessages(messages);

		const body: Anthropic.MessageStreamParams = {
			model: model.id,
			max_tokens: options.modelOptions?.maxTokens ?? this.maxOutputTokens,
			tools,
			tool_choice,
			system,
			messages: anthropicMessages,
		};

		const stream = this._client.messages.stream(body);

		// Log request information - the request ID is only available upon connection.
		stream.on('connect', () => {
			log.info(`[anthropic] Start request ${stream.request_id} to ${model.id}: ${anthropicMessages.length} messages`);
			if (log.logLevel <= vscode.LogLevel.Trace) {
				log.trace(`[anthropic] SEND messages.stream [${stream.request_id}]: ${JSON.stringify(body, null, 2)}`);
			} else {
				const userMessages = body.messages.filter(m => m.role === 'user');
				const assistantMessages = body.messages.filter(m => m.role === 'assistant');
				log.debug(
					`[anthropic] SEND messages.stream [${stream.request_id}]: ` +
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
				progress.report({ index: 0, part: part });
			}
		});

		try {
			await stream.done();
		} catch (error) {
			if (error instanceof Anthropic.APIError) {
				log.warn(`[anthropic] Error in messages.stream [${stream.request_id}]: ${error.message}`);
				let data: any;
				try {
					data = JSON.parse(error.message);
				} catch {
					// Ignore JSON parse errors.
				}
				if (data?.error?.type === 'overloaded_error') {
					throw new Error(`Anthropic's API is temporarily overloaded.`);
				}
			} else if (error instanceof Anthropic.AnthropicError) {
				log.warn(`[anthropic] Error in messages.stream [${stream.request_id}]: ${error.message}`);
				// This can happen if the API key was not persisted correctly.
				if (error.message.startsWith('Could not resolve authentication method')) {
					throw new Error('Something went wrong when storing the Anthropic API key. ' +
						'Please delete and recreate the model configuration.');
				}
			}
			throw error;
		}

		// Log usage information.
		const message = await stream.finalMessage();
		if (log.logLevel <= vscode.LogLevel.Trace) {
			log.trace(`[anthropic] RECV messages.stream [${stream.request_id}]: ${JSON.stringify(message, null, 2)}`);
		} else {
			log.debug(
				`[anthropic] RECV messages.stream [${stream.request_id}]`);
			log.info(`[anthropic] Finished request ${stream.request_id}; usage: ${JSON.stringify(message.usage)}`);
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

	get providerName(): string {
		return AnthropicLanguageModel.source.provider.displayName;
	}

	private onContentBlock(block: Anthropic.ContentBlock, progress: vscode.Progress<vscode.ChatResponseFragment2>): void {
		switch (block.type) {
			case 'tool_use':
				return this.onToolUseBlock(block, progress);
		}
	}

	private onToolUseBlock(block: Anthropic.ToolUseBlock, progress: vscode.Progress<vscode.ChatResponseFragment2>): void {
		progress.report({
			index: 0,
			part: new vscode.LanguageModelToolCallPart(block.id, block.name, block.input as any),
		});
	}

	private onText(textDelta: string, progress: vscode.Progress<vscode.ChatResponseFragment2>): void {
		progress.report({
			index: 0,
			part: new vscode.LanguageModelTextPart(textDelta),
		});
	}

	async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatMessage2, token: vscode.CancellationToken): Promise<number> {
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

	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		try {
			await this._client.models.list();
		} catch (error) {
			return error as Error;
		}
	}
}

function toTokenUsage(usage: Anthropic.MessageDeltaUsage): TokenUsage {
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

function toAnthropicMessages(messages: vscode.LanguageModelChatMessage2[]): Anthropic.MessageParam[] {
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
			throw new Error(`Unsupported message role: ${message.role}`);
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
			throw new Error('Unsupported part type on assistant message');
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
			}
		} else {
			throw new Error('Unsupported part type on user message');
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
		} else if (isLanguageModelImagePart(resultPart)) {
			content.push(languageModelImagePartToAnthropicImageBlock(resultPart, source, resultDataPart));
		} else if (resultPart instanceof vscode.LanguageModelDataPart) {
			// Skip data parts.
		} else if (resultPart instanceof vscode.LanguageModelPromptTsxPart) {
			content.push(languageModelPromptTsxPartToAnthropicBlock(resultPart, source, resultDataPart));
		} else {
			throw new Error(`Unsupported part type on tool result part content: ${JSON.stringify(resultPart)}`);
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

function languageModelImagePartToAnthropicImageBlock(
	part: LanguageModelImagePart,
	source: string,
	dataPart?: vscode.LanguageModelDataPart,
): Anthropic.ImageBlockParam {
	return withCacheControl(
		{
			type: 'image',
			source: {
				type: 'base64',
				// We may pass an unsupported mime type; let Anthropic throw the error.
				media_type: part.value.mimeType as Anthropic.Base64ImageSource['media_type'],
				data: part.value.base64,
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

function toAnthropicTools(tools: vscode.LanguageModelChatTool[]): Anthropic.ToolUnion[] {
	if (tools.length === 0) {
		return [];
	}
	const anthropicTools = tools.map(tool => toAnthropicTool(tool));

	// Ensure a stable sort order for prompt caching.
	anthropicTools.sort((a, b) => a.name.localeCompare(b.name));

	return anthropicTools;
}

function toAnthropicTool(tool: vscode.LanguageModelChatTool): Anthropic.ToolUnion {
	const input_schema = tool.inputSchema as Anthropic.Tool.InputSchema ?? {
		type: 'object',
		properties: {},
	};
	// Anthropic requires a type for all tools; default to 'object' if not provided.
	if (!input_schema.type) {
		log.warn(`[anthropic] Tool '${tool.name}' is missing input schema type; defaulting to 'object'`);
		input_schema.type = 'object';
	}
	return {
		name: tool.name,
		description: tool.description,
		input_schema,
	};
}

function toAnthropicToolChoice(toolMode: vscode.LanguageModelChatToolMode): Anthropic.ToolChoice | undefined {
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
			throw new Error(`Unsupported tool mode: ${toolMode}`);
	}
}

function toAnthropicSystem(system: unknown, cacheSystem = true): Anthropic.MessageCreateParams['system'] {
	if (typeof system === 'string') {
		const anthropicSystem: Anthropic.MessageCreateParams['system'] = [{
			type: 'text',
			text: system,
		}];

		if (cacheSystem) {
			// Add a cache breakpoint to the last system prompt block.
			const lastSystemBlock = anthropicSystem[anthropicSystem.length - 1];
			lastSystemBlock.cache_control = { type: 'ephemeral' };
			log.debug(`[anthropic] Adding cache breakpoint to system prompt`);
		}

		return anthropicSystem;
	}

	// Check if it's an array of parts.
	if (Array.isArray(system) && system.every(part => (part instanceof vscode.LanguageModelTextPart) ||
		(part instanceof vscode.LanguageModelDataPart))) {
		const anthropicSystem: Anthropic.MessageCreateParams['system'] = [];
		for (let i = 0; i < system.length; i++) {
			const [part, nextPart] = [system[i], system[i + 1]];
			const dataPart = nextPart instanceof vscode.LanguageModelDataPart ? nextPart : undefined;
			if (part instanceof vscode.LanguageModelTextPart) {
				anthropicSystem.push(toAnthropicTextBlock(part, 'System prompt', dataPart));
			}
		}
		return anthropicSystem;
	}

	throw new Error(`Unexpected system prompt value`);
}

function isCacheControlOptions(options: unknown): options is CacheControlOptions {
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
		const cachBreakpoint = parseCacheBreakpoint(dataPart);
		log.debug(`[anthropic] Adding cache breakpoint to ${part.type} part. Source: ${source}`);
		return {
			...part,
			cache_control: cachBreakpoint,
		};
	} catch (error) {
		log.error(`[anthropic] Failed to parse cache breakpoint: ${error}`);
		return part;
	}
}
