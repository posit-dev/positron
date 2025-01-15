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
import { toAIMessage } from './utils';

class ErrorLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Error Language Model';
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
	readonly identifier = 'echo-language-model';

	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: { [name: string]: any },
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment>,
		token: vscode.CancellationToken
	): Promise<any> {
		const _messages = toAIMessage(messages);
		for await (const i of _messages[_messages.length - 1].content.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			progress.report({ index: 0, part: i });
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
	public readonly identifier;
	protected abstract model: ai.LanguageModelV1;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.id;
		this.name = _config.name;
	}

	/*
	 * Handler for for vscode.lm `sendRequest` API and `positron.ai.sendLanguageModelRequest` API.
	 */
	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: { [key: string]: any },
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment>,
		token: vscode.CancellationToken
	) {
		const _messages = toAIMessage(messages);
		const controller = new AbortController();
		const signal = controller.signal;

		const result = ai.streamText({
			model: this.model,
			system: options.system ?? undefined,
			messages: _messages,
			maxSteps: options.maxSteps ?? 5,
			tools: options.tools ?? undefined,
			abortSignal: signal,
		});

		for await (const delta of result.textStream) {
			if (token.isCancellationRequested) {
				controller.abort();
				break;
			}
			progress.report({ index: 0, part: delta });
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
		supportedOptions: ['apiKey', 'baseUrl'],
		defaults: {
			name: 'GPT-4o',
			model: 'gpt-4o',
			baseUrl: 'https://api.openai.com',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOpenAI({ apiKey: this._config.apiKey })(this._config.model);
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
		supportedOptions: ['baseUrl'],
		defaults: {
			name: 'Qwen 2.5',
			model: 'qwen2.5-coder:7b',
			baseUrl: 'http://localhost:11434/api',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOllama({ baseURL: this._config.baseUrl })(this._config.model);
	}

	async provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: { [key: string]: any },
		extensionId: string,
		progress: vscode.Progress<vscode.ChatResponseFragment>,
		token: vscode.CancellationToken
	) {
		// Ollama does not support streaming with tool calls yet
		options.tools = undefined;
		return super.provideLanguageModelResponse(messages, options, extensionId, progress, token);
	}
}

export function newLanguageModel(config: ModelConfig): positron.ai.LanguageModelChatProvider {
	const providerClasses = {
		'echo': EchoLanguageModel,
		'error': ErrorLanguageModel,
		'openai': OpenAILanguageModel,
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
	OllamaLanguageModel,
];
