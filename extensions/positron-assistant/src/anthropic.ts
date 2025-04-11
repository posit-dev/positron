/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';
import { ModelConfig } from './config';
import { isLanguageModelImagePart, LanguageModelImagePart } from './languageModelParts.js';

export class AnthropicLanguageModel implements positron.ai.LanguageModelChatProvider {
	name: string;
	provider: string;
	identifier: string;

	private readonly _client: Anthropic;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'anthropic',
			displayName: 'Anthropic Claude'
		},
		supportedOptions: ['apiKey'],
		defaults: {
			name: 'Claude 3.5 Sonnet',
			model: 'claude-3-5-sonnet-latest',
			toolCalls: true,
		},
	};

	constructor(private readonly _config: ModelConfig) {
		this.name = AnthropicLanguageModel.source.defaults.name;
		this.provider = _config.provider;
		this.identifier = _config.id;
		this._client = new Anthropic({
			apiKey: _config.apiKey,
		});
	}

	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: vscode.LanguageModelChatRequestOptions,
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment2>,
		token: vscode.CancellationToken
	) {
		const anthropicMessages = messages.map(message => toAnthropicMessage(message));
		const tools = options.tools?.map(tool => toAnthropicTool(tool));
		const tool_choice = options.toolMode && toAnthropicToolChoice(options.toolMode);
		const stream = this._client.messages.stream({
			model: this._config.model,
			// TODO: How do we decide on default max tokens?
			max_tokens: options.modelOptions?.maxTokens ?? 1024,
			messages: anthropicMessages,
			tool_choice,
			tools,
			system: options.modelOptions?.system,
		});

		token.onCancellationRequested(() => {
			stream.abort();
		});

		stream.on('contentBlock', (contentBlock) => {
			this.onContentBlock(contentBlock, progress);
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
	}

	getProviderDisplayName(): string {
		return AnthropicLanguageModel.source.provider.displayName;
	}

	private onContentBlock(block: Anthropic.Messages.ContentBlock, progress: vscode.Progress<vscode.ChatResponseFragment2>): void {
		switch (block.type) {
			case 'text':
				return this.onTextBlock(block, progress);
			case 'tool_use':
				return this.onToolUseBlock(block, progress);
		}
	}

	private onTextBlock(contentBlock: Anthropic.Messages.TextBlock, progress: vscode.Progress<vscode.ChatResponseFragment2>): void {
		progress.report({
			index: 0,
			part: new vscode.LanguageModelTextPart(contentBlock.text),
		});
	}

	private onToolUseBlock(block: Anthropic.Messages.ToolUseBlock, progress: vscode.Progress<vscode.ChatResponseFragment2>): void {
		progress.report({
			index: 0,
			part: new vscode.LanguageModelToolCallPart(block.id, block.name, block.input as any),
		});
	}

	async provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Promise<number> {
		const messages: Anthropic.MessageParam[] = typeof text === 'string' ?
			[{
				role: 'user',
				content: [
					{
						type: 'text',
						text,
					},
				],
			}] :
			[toAnthropicMessage(text)];
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

function toAnthropicMessage(message: vscode.LanguageModelChatMessage): Anthropic.MessageParam {
	switch (message.role) {
		case vscode.LanguageModelChatMessageRole.Assistant:
			return toAnthropicAssistantMessage(message);
		case vscode.LanguageModelChatMessageRole.User:
			return toAnthropicUserMessage(message);
		default:
			throw new Error(`Unsupported message role: ${message.role}`);
	}
}

function toAnthropicAssistantMessage(message: vscode.LanguageModelChatMessage): Anthropic.MessageParam {
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

function toAnthropicUserMessage(message: vscode.LanguageModelChatMessage): Anthropic.MessageParam {
	const content: Anthropic.ContentBlockParam[] = [];
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			content.push(toAnthropicTextBlock(part));
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			content.push(toAnthropicToolResultBlock(part));
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
			content.push(toAnthropicImageBlock(resultPart));
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

function toAnthropicImageBlock(part: LanguageModelImagePart): Anthropic.ImageBlockParam {
	return {
		type: 'image',
		source: {
			type: 'base64',
			// We may pass an unsupported mime type; let Anthropic throw the error.
			media_type: part.value.mimeType as any,
			data: part.value.base64,
		},
	};
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
