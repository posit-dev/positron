/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { ModelConfig } from './config';
import { isLanguageModelImagePart, LanguageModelImagePart } from './languageModelParts.js';
import { isChatImagePart, processMessages } from './utils.js';
import { DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { log } from './extension.js';

/**
 * Options for controlling cache behavior in the Anthropic language model.
 */
export interface CacheControlOptions {
	/** Add a cache control point to the system prompt (default: true). */
	system?: boolean;
}


export class AnthropicLanguageModel implements positron.ai.LanguageModelChatProvider {
	name: string;
	provider: string;
	identifier: string;
	maxOutputTokens: number;

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	private readonly _client: Anthropic;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'anthropic',
			displayName: 'Anthropic'
		},
		supportedOptions: ['apiKey'],
		defaults: {
			name: 'Claude 3.5 Sonnet v2',
			model: 'claude-3-5-sonnet-latest',
			toolCalls: true,
		},
	};

	constructor(
		private readonly _config: ModelConfig,
		client?: Anthropic,
	) {
		this.name = _config.name;
		this.provider = _config.provider;
		this.identifier = _config.id;
		this._client = client ?? new Anthropic({
			apiKey: _config.apiKey,
		});
		this.maxOutputTokens = _config.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT;
	}

	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.LanguageModelChatRequestOptions,
		extensionId: string,
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
			model: this._config.model,
			max_tokens: options.modelOptions?.maxTokens ?? this.maxOutputTokens,
			tools,
			tool_choice,
			system,
			messages: anthropicMessages,
		};
		const stream = this._client.messages.stream(body);

		// Log request information - the request ID is only available upon connection.
		stream.on('connect', () => {
			if (log.logLevel <= vscode.LogLevel.Trace) {
				log.trace(`[anthropic] SEND messages.stream [${stream.request_id}]: ${JSON.stringify(body)}`);
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

		try {
			await stream.done();
		} catch (error) {
			if (error instanceof Anthropic.APIError) {
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
			log.trace(`[anthropic] RECV messages.stream [${stream.request_id}]: ${JSON.stringify(message)}`);
		} else {
			log.debug(
				`[anthropic] RECV messages.stream [${stream.request_id}]: ` +
				`usage: ${JSON.stringify(message.usage)}`
			);
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

	async provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Promise<number> {
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
			const processedMessages = processMessages([text]);
			if (processedMessages.length === 0) {
				return 0;
			}
			messages.push(...processedMessages.map(toAnthropicMessage));
		}
		const result = await this._client.messages.countTokens({
			model: this._config.model,
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

function toAnthropicMessages(messages: vscode.LanguageModelChatMessage2[]): Anthropic.MessageParam[] {
	const anthropicMessages = processMessages(messages).map(toAnthropicMessage);
	return anthropicMessages;
}

function toAnthropicMessage(message: vscode.LanguageModelChatMessage2): Anthropic.MessageParam {
	switch (message.role) {
		case vscode.LanguageModelChatMessageRole.Assistant:
			return toAnthropicAssistantMessage(message);
		case vscode.LanguageModelChatMessageRole.User:
			return toAnthropicUserMessage(message);
		default:
			throw new Error(`Unsupported message role: ${message.role}`);
	}
}

function toAnthropicAssistantMessage(message: vscode.LanguageModelChatMessage2): Anthropic.MessageParam {
	const content: Anthropic.ContentBlockParam[] = [];
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(part));
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			content.push(toAnthropicToolUseBlock(part));
		} else {
			throw new Error('Unsupported part type on assistant message');
		}
	}
	return {
		role: 'assistant',
		content,
	};
}

function toAnthropicUserMessage(message: vscode.LanguageModelChatMessage2): Anthropic.MessageParam {
	const content: Anthropic.ContentBlockParam[] = [];
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(part));
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			content.push(toAnthropicToolResultBlock(part));
		} else if (part instanceof vscode.LanguageModelToolResultPart2) {
			content.push(toAnthropicToolResultBlock(part));
		} else if (part instanceof vscode.LanguageModelDataPart) {
			if (isChatImagePart(part)) {
				content.push(chatImagePartToAnthropicImageBlock(part));
			} else {
				throw new Error('Unsupported language model data part type on user message');
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

function toAnthropicTextBlock(part: vscode.LanguageModelTextPart): Anthropic.TextBlockParam {
	return {
		type: 'text',
		text: part.value,
	};
}

function toAnthropicToolUseBlock(part: vscode.LanguageModelToolCallPart): Anthropic.ToolUseBlockParam {
	return {
		type: 'tool_use',
		id: part.callId,
		name: part.name,
		input: part.input,
	};
}

function toAnthropicToolResultBlock(part: vscode.LanguageModelToolResultPart): Anthropic.ToolResultBlockParam {
	const content: Anthropic.ToolResultBlockParam['content'] = [];
	for (const resultPart of part.content) {
		if (resultPart instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(resultPart));
		} else if (isLanguageModelImagePart(resultPart)) {
			content.push(languageModelImagePartToAnthropicImageBlock(resultPart));
		} else {
			throw new Error('Unsupported part type on tool result part content');
		}
	}
	return {
		type: 'tool_result',
		tool_use_id: part.callId,
		content,
	};
}

function chatImagePartToAnthropicImageBlock(part: vscode.LanguageModelDataPart): Anthropic.ImageBlockParam {
	return {
		type: 'image',
		source: {
			type: 'base64',
			// We may pass an unsupported mime type; let Anthropic throw the error.
			media_type: part.mimeType as Anthropic.Base64ImageSource['media_type'],
			data: Buffer.from(part.data).toString('base64'),
		},
	};
}

function languageModelImagePartToAnthropicImageBlock(part: LanguageModelImagePart): Anthropic.ImageBlockParam {
	return {
		type: 'image',
		source: {
			type: 'base64',
			// We may pass an unsupported mime type; let Anthropic throw the error.
			media_type: part.value.mimeType as Anthropic.Base64ImageSource['media_type'],
			data: part.value.base64,
		},
	};
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
			// Add a cache control point to the last system prompt block.
			const lastSystemBlock = anthropicSystem[anthropicSystem.length - 1];
			lastSystemBlock.cache_control = { type: 'ephemeral' };
			log.debug(`[anthropic] Adding cache control point to system prompt`);
		}

		return anthropicSystem;
	}
	// Pass the system prompt through as-is.
	// We may pass an invalid system prompt; let Anthropic throw the error.
	return system as Anthropic.MessageCreateParams['system'];
}

function isCacheControlOptions(options: unknown): options is CacheControlOptions {
	if (typeof options !== 'object' || options === null) {
		return false;
	}
	const cacheControlOptions = options as CacheControlOptions;
	return cacheControlOptions.system === undefined || typeof cacheControlOptions.system === 'boolean';
}
