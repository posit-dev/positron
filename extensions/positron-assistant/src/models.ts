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

	async provideChatResponse(): Promise<void> {
		throw new Error(this._message);
	}
}

class EchoLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Echo Language Model';
	readonly identifier = 'echo-language-model';

	async provideChatResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: { [key: string]: any },
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	) {
		const _messages = toAIMessage(messages);
		for await (const i of _messages[_messages.length - 1].content.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			response.markdown(i);
			if (token.isCancellationRequested) {
				return;
			}
		}
	}
}

abstract class AILanguageModel implements positron.ai.LanguageModelChatProvider {
	public readonly name;
	public readonly identifier;
	protected abstract model: ai.LanguageModelV1;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.name.toLowerCase().replace(/\s+/g, '-');
		this.name = _config.name;
	}

	async provideChatResponse(
		messages: vscode.LanguageModelChatMessage[],
		options: { [key: string]: any },
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	) {
		const _messages = toAIMessage(messages);

		const result = ai.streamText({
			model: this.model,
			system: options.system,
			messages: _messages,
			maxSteps: options.maxSteps ?? 5,
			tools: options.tools,
		});

		for await (const delta of result.textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			response.markdown(delta);
		}
	}
}

class AnthropicAssistant extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;
	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createAnthropic({ apiKey: this._config.apiKey })(this._config.model);
	}
}

class OpenAIAssistant extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;
	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOpenAI({ apiKey: this._config.apiKey })(this._config.model);
	}
}

class OllamaAssistant extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;
	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOllama({ baseURL: this._config.baseUrl })(this._config.model);
	}
}

export function newLanguageModel(config: ModelConfig): positron.ai.LanguageModelChatProvider {
	const providerClasses = {
		'echo': EchoLanguageModel,
		'error': ErrorLanguageModel,
		'openai': OpenAIAssistant,
		'anthropic': AnthropicAssistant,
		'ollama': OllamaAssistant,
	};

	if (!providerClasses[config.provider]) {
		throw new Error(`Unsupported provider: ${config.provider}`);
	}

	return new providerClasses[config.provider](config);
}
