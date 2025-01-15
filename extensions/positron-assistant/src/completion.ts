/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';

import { ModelConfig } from './config';
import { createOllama } from 'ollama-ai-provider';

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
		// Delay a little before hitting the network, we might be cancelled by further keystokes
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
			baseUrl: 'http://localhost:11434',
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

		const filename = document.fileName;
		const { prefix, suffix, prevLines, nextLines } = this.getDocumentContext(document, position);

		const controller = new AbortController();
		const signal = controller.signal;

		const { textStream } = await ai.streamText({
			model: this.model,
			prompt: `<|file_sep|>${filename}\n${document.getText()}\n<|fim_prefix|>${prevLines}\n${prefix}<|fim_suffix|>${suffix}\n${nextLines}<|fim_middle|>`,
			stopSequences: [`\n\n`],
			maxTokens: 256,
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

export function newCompletionProvider(config: ModelConfig): vscode.InlineCompletionItemProvider {
	const providerClasses = {
		'ollama': OllamaCompletion,
		'mistral': MistralCompletion,
	};

	if (!(config.provider in providerClasses)) {
		throw new Error(`Unsupported completion provider: ${config.provider}`);
	}

	return new providerClasses[config.provider as keyof typeof providerClasses](config);
}

export const completionModels = [
	MistralCompletion,
	OllamaCompletion,
];
