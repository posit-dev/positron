/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import * as fs from 'fs';

import { ModelConfig } from './config';
import { createOllama } from 'ollama-ai-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { EXTENSION_ROOT_DIR } from './constants';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

abstract class CompletionModel implements vscode.InlineCompletionItemProvider {
	public name;
	public identifier;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.id;
		this.name = _config.name;
	}

	abstract provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList>;

	getDocumentContext(document: vscode.TextDocument, position: vscode.Position) {
		const prefix = document.lineAt(position.line).text.substring(0, position.character);
		const suffix = document.lineAt(position.line).text.substring(position.character);
		const prevLines = Array.from({ length: position.line }, (_, i) => {
			return document.lineAt(i).text;
		}).join('\n');
		const nextLines = Array.from({ length: document.lineCount - position.line - 1 }, (_, i) => {
			return document.lineAt(position.line + i + 1).text;
		}).join('\n');

		return { prefix, suffix, prevLines, nextLines };
	}
}

class MistralCompletion extends CompletionModel {
	static source: positron.ai.LanguageModelSource = {
		type: 'completion',
		provider: {
			id: 'mistral',
			displayName: 'Mistral'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'Codestral',
			model: 'codestral-latest',
			apiKey: '',
			baseUrl: 'https://api.mistral.ai',
		},
	};

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		// Delay a little before hitting the network, we might be cancelled by further keystrokes
		await new Promise(resolve => setTimeout(resolve, 200));

		if (token.isCancellationRequested) {
			return [];
		}

		// Can we use Vercel AI here?
		const { prefix, suffix, prevLines, nextLines } = this.getDocumentContext(document, position);
		const response = await fetch(`${this._config.baseUrl}/v1/fim/completions`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this._config.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: this._config.model,
				temperature: 0.2,
				prompt: `${prevLines}\n${prefix}`,
				suffix: `${suffix}\n${nextLines}`,
				max_tokens: 128,
				stop: '\n\n',
			})
		});

		if (!response.ok) {
			throw new Error(response.statusText);
		}

		const data = await response.json() as { choices: { message: { content: string } }[] };
		return [{
			insertText: data.choices[0].message.content
		}];
	}
}

class OllamaCompletion extends CompletionModel {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: 'completion',
		provider: {
			id: 'ollama',
			displayName: 'Ollama'
		},
		supportedOptions: ['baseUrl'],
		defaults: {
			name: 'Qwen 2.5 Base',
			model: 'qwen2.5-coder:7b-base',
			baseUrl: 'http://localhost:11434/api',
		},
	};

	constructor(protected readonly _config: ModelConfig) {
		super(_config);
		this.model = createOllama({ baseURL: this._config.baseUrl })(this._config.model);
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		if (token.isCancellationRequested) {
			return [];
		}

		const { prefix, suffix, prevLines, nextLines } = this.getDocumentContext(document, position);
		const controller = new AbortController();
		const signal = controller.signal;

		const { textStream } = await ai.streamText({
			model: this.model,
			prompt: `<|fim_prefix|>${prevLines}\n${prefix}<|fim_suffix|>${suffix}\n${nextLines}\n<|fim_middle|>`,
			maxTokens: 64,
			abortSignal: signal,
		});

		let text = '';
		for await (const delta of textStream) {
			if (token.isCancellationRequested) {
				controller.abort();
				break;
			}
			text += delta;
		}

		return [{ insertText: text }];
	}
}

abstract class FimPromptCompletion extends CompletionModel {
	protected abstract model: ai.LanguageModelV1;

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		// Delay a little before hitting the network, we might be cancelled by further keystrokes
		await new Promise(resolve => setTimeout(resolve, 200));

		if (token.isCancellationRequested) {
			return [];
		}

		// TODO: Include additional files in <file></file> tags as context.
		// TODO: We should have some way for the user to override how the FIM prompt is built,
		//       particularly for OpenRouter models.
		const filename = document.fileName;
		const { prefix, suffix, prevLines, nextLines } = this.getDocumentContext(document, position);

		const controller = new AbortController();
		const signal = controller.signal;

		const system: string = await fs.promises.readFile(`${mdDir}/prompts/completion/fim.md`, 'utf8');
		const { textStream } = await ai.streamText({
			model: this.model,
			system: system,
			messages: [{ role: 'user', content: `<file>${filename}\n${document.getText()}\n</file><prefix>${prevLines}\n${prefix}</prefix><suffix>${suffix}\n${nextLines}</suffix>` }],
			maxTokens: 128,
			abortSignal: signal,
		});

		let text = '';
		for await (const delta of textStream) {
			if (token.isCancellationRequested) {
				controller.abort();
				break;
			}
			text += delta;
		}

		return [{ insertText: text }];
	}
}

class AnthropicCompletion extends FimPromptCompletion {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: 'completion',
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

	constructor(protected readonly _config: ModelConfig) {
		super(_config);
		this.model = createAnthropic({ apiKey: this._config.apiKey })(this._config.model);
	}
}

class OpenAICompletion extends FimPromptCompletion {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: 'completion',
		provider: {
			id: 'openai',
			displayName: 'OpenAI'
		},
		supportedOptions: ['apiKey', 'baseUrl'],
		defaults: {
			name: 'GPT-4o',
			model: 'gpt-4o',
			baseUrl: 'https://api.openai.com/v1',
		},
	};

	constructor(protected readonly _config: ModelConfig) {
		super(_config);
		this.model = createOpenAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		})(this._config.model);
	}
}

class OpenRouterCompletion extends FimPromptCompletion {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: 'completion',
		provider: {
			id: 'openrouter',
			displayName: 'OpenRouter'
		},
		supportedOptions: ['apiKey', 'baseUrl'],
		defaults: {
			name: 'Claude 3.5 Sonnet',
			model: 'anthropic/claude-3.5-sonnet',
			baseUrl: 'https://openrouter.ai/api/v1',
		},
	};

	constructor(protected readonly _config: ModelConfig) {
		super(_config);
		this.model = createOpenRouter({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		})(this._config.model);
	}
}
export class AWSLanguageModel extends FimPromptCompletion {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: 'completion',
		provider: {
			id: 'bedrock',
			displayName: 'AWS Bedrock'
		},
		supportedOptions: [],
		defaults: {
			name: 'Claude 3.5 Sonnet v2',
			model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);

		this.model = createAmazonBedrock({
			bedrockOptions: {
				credentials: fromNodeProviderChain(),
			}
		})(this._config.model);
	}
}

export function newCompletionProvider(config: ModelConfig): vscode.InlineCompletionItemProvider {
	const providerClasses = {
		'ollama': OllamaCompletion,
		'openai': OpenAICompletion,
		'mistral': MistralCompletion,
		'anthropic': AnthropicCompletion,
		'openrouter': OpenRouterCompletion,
		'bedrock': AWSLanguageModel,
	};

	if (!(config.provider in providerClasses)) {
		throw new Error(`Unsupported completion provider: ${config.provider}`);
	}

	return new providerClasses[config.provider as keyof typeof providerClasses](config);
}

export const completionModels = [
	MistralCompletion,
	OllamaCompletion,
	AnthropicCompletion,
	OpenAICompletion,
	OpenRouterCompletion,
	AWSLanguageModel,
];
