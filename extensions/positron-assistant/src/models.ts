/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { ModelConfig } from './config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { replaceBinaryMessageParts, toAIMessage } from './utils';
import { positronToolAdapters } from './tools';

class ErrorLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Error Language Model';
	readonly provider = 'error';
	readonly identifier = 'error-language-model';
	private readonly _message = 'This language model always throws an error message.';

	provideLanguageModelResponse(): Promise<any> {
		throw new Error(this._message);
	}

	provideTokenCount(): Promise<number> {
		throw new Error(this._message);
	}
}

class EchoLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Echo Language Model';
	readonly provider = 'echo';
	readonly identifier = 'echo-language-model';

	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: { [name: string]: any },
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment2>,
		token: vscode.CancellationToken
	): Promise<any> {
		const _messages = toAIMessage(messages);
		const message = _messages[_messages.length - 1];

		if (typeof message.content === 'string') {
			message.content = [{ type: 'text', text: message.content }];
		}

		if (message.content[0].type !== 'text') {
			throw new Error('Echo language model only supports text messages.');
		}

		for await (const i of message.content[0].text.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			progress.report({ index: 0, part: new vscode.LanguageModelTextPart(i) });
			if (token.isCancellationRequested) {
				return;
			}
		}
	}

	async provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Promise<number> {
		if (typeof text === 'string') {
			return text.length;
		} else {
			const _text = toAIMessage([text]);
			return _text.length > 0 ? _text[0].content.length : 0;
		}
	}
}

abstract class AILanguageModel implements positron.ai.LanguageModelChatProvider {
	public readonly name;
	public readonly provider;
	public readonly identifier;
	protected abstract model: ai.LanguageModelV1;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.id;
		this.name = _config.name;
		this.provider = _config.provider;
	}

	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: vscode.LanguageModelChatRequestOptions,
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment2>,
		token: vscode.CancellationToken
	) {
		const modelOptions = options.modelOptions ?? {};
		const controller = new AbortController();
		const signal = controller.signal;
		let tools: Record<string, ai.CoreTool> | undefined;

		const _messages = replaceBinaryMessageParts(
			toAIMessage(messages),
			options.modelOptions?.binaryReferences ?? {}
		);

		if (options.tools && options.tools.length > 0) {
			tools = options.tools.reduce((acc: Record<string, ai.CoreTool>, tool: vscode.LanguageModelChatTool) => {
				/* For the tools in this extension, create an ai.CoreTool object using the given
				 * invocation token. This enables our tools to stream back to the chat response
				 * model directly.
				 */
				if (modelOptions.toolInvocationToken && tool.name in positronToolAdapters) {
					acc[tool.name] = positronToolAdapters[tool.name].aiTool(
						modelOptions.toolInvocationToken,
						modelOptions.toolOptions[tool.name]
					);
				} else {
					// For any other tool, create an ai.CoreTool object from scratch.
					acc[tool.name] = ai.tool({
						description: tool.description,
						parameters: ai.jsonSchema(tool.inputSchema ?? { type: 'object', properties: {} }),
					});
				}
				return acc;
			}, {});
		}

		const result = ai.streamText({
			model: this.model,
			system: modelOptions.system ?? undefined,
			messages: _messages,
			maxSteps: modelOptions.maxSteps ?? 50,
			tools: this._config.toolCalls ? tools : undefined,
			abortSignal: signal,
		});

		for await (const part of result.fullStream) {
			if (token.isCancellationRequested) {
				controller.abort();
				break;
			}

			if (part.type === 'text-delta') {
				progress.report({
					index: 0,
					part: new vscode.LanguageModelTextPart(part.textDelta)
				});
			}

			if (part.type === 'tool-call') {
				progress.report({
					index: 0,
					part: new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, part.args)
				});
			}

			if (part.type === 'error') {
				if (typeof part.error === 'string') {
					throw new Error(part.error);
				}
				if ((part.error as any).responseBody) {
					const error = (part.error as any).responseBody as string;
					throw new Error(error);
				}
				throw new Error(JSON.stringify(part.error));
			}
		}
	}

	async provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Promise<number> {
		// TODO: This is a very naive approximation, a model specific tokenizer should be used.
		return typeof text === 'string' ? text.length : JSON.stringify(text.content).length;
	}
}

class AnthropicLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: 'chat',
		provider: {
			id: 'anthropic',
			displayName: 'Anthropic'
		},
		supportedOptions: ['apiKey'],
		defaults: {
			name: 'Claude 3.5 Sonnet',
			model: 'claude-3-5-sonnet-latest',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createAnthropic({ apiKey: this._config.apiKey })(this._config.model);
	}
}

class OpenAILanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: 'chat',
		provider: {
			id: 'openai',
			displayName: 'OpenAI'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'GPT-4o',
			model: 'gpt-4o',
			baseUrl: 'https://api.openai.com',
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOpenAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		})(this._config.model);
	}
}

class OpenRouterLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: 'chat',
		provider: {
			id: 'openrouter',
			displayName: 'OpenRouter'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'Claude 3.5 Sonnet',
			model: 'anthropic/claude-3.5-sonnet',
			baseUrl: 'https://openrouter.ai/api/v1',
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOpenRouter({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		})(this._config.model);
	}
}

class OllamaLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: 'chat',
		provider: {
			id: 'ollama',
			displayName: 'Ollama'
		},
		supportedOptions: ['baseUrl', 'toolCalls'],
		defaults: {
			name: 'Qwen 2.5',
			model: 'qwen2.5-coder:7b',
			baseUrl: 'http://localhost:11434/api',
			toolCalls: false,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOllama({ baseURL: this._config.baseUrl })(this._config.model);
	}
}

export function newLanguageModel(config: ModelConfig): positron.ai.LanguageModelChatProvider {
	const providerClasses = {
		'echo': EchoLanguageModel,
		'error': ErrorLanguageModel,
		'openai': OpenAILanguageModel,
		'openrouter': OpenRouterLanguageModel,
		'anthropic': AnthropicLanguageModel,
		'ollama': OllamaLanguageModel,
	};

	if (!(config.provider in providerClasses)) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}

	return new providerClasses[config.provider as keyof typeof providerClasses](config);
}

export const languageModels = [
	AnthropicLanguageModel,
	OpenAILanguageModel,
	OpenRouterLanguageModel,
	OllamaLanguageModel,
];
