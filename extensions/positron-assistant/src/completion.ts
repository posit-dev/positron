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
import { createVertex } from '@ai-sdk/google-vertex';
import { createAzure } from '@ai-sdk/azure';

import { loadSetting } from '@ai-sdk/provider-utils';
import { GoogleAuth } from 'google-auth-library';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

/**
 * Models used for autocomplete/ghost text.
 *
 * A minor complication here is that there does not yet seem to be a universally agreed-upon FIM
 * completions API. OpenAI has a completions API, but it is considered legacy and does not work with
 * their latest models. Yet, some other providers still implement it for newer models.
 *
 * With local llama models, delimiter tokens are used to separate prefix and suffix content, but the
 * specific tokens are subtly different between open source models. Ollama has the concept of a
 * prompt template to help deal with this.
 *
 * Some providers do not provide completion models. For those providers we can emulate FIM with
 * prompt engineering.
 */

//#region Document context

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
		// TODO: Use similarity scores with recently opened documents to build wider context
		// TODO: Limit context to some number of tokens (probably just characters for now)
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

//#endregion
//#region OpenAI Legacy API
// (OpenAI FIM, DeepSeek, Mistral)

class OpenAILegacyCompletion extends CompletionModel {
	url: string;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'openai-legacy',
			displayName: 'OpenAI (Legacy)'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'GPT 3.5 Turbo',
			model: 'gpt-3.5-turbo-instruct',
			apiKey: '',
			baseUrl: 'https://api.openai.com/v1',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.url = `${this._config.baseUrl}/completions`;
	}

	async getAccessToken() {
		return this._config.apiKey;
	}

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

		const { prefix, suffix, prevLines, nextLines } = this.getDocumentContext(document, position);

		const accessToken = await this.getAccessToken();
		const response = await fetch(this.url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: this._config.model,
				temperature: 0.2,
				prompt: `${prevLines}\n${prefix}`,
				suffix: `${suffix}\n${nextLines}`,
				max_tokens: 128,
				stop: ['\n\n', '<|endoftext|>'],
			})
		});

		if (!response.ok) {
			throw new Error(response.statusText);
		}

		const data = await response.json() as {
			choices: { message: { content: string } }[];
		} | {
			choices: { text: string }[];
		};

		return data.choices.map((choice) => {
			if ('text' in choice) {
				return { insertText: choice.text };
			} else {
				return { insertText: choice.message.content };
			}
		});
	}
}

class MistralCompletion extends OpenAILegacyCompletion {
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'mistral',
			displayName: 'Mistral'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'Codestral',
			model: 'codestral-latest',
			apiKey: '',
			baseUrl: 'https://api.mistral.ai/v1',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.url = `${this._config.baseUrl}/fim/completions`;
	}
}

class DeepSeekCompletion extends OpenAILegacyCompletion {
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'deepseek',
			displayName: 'DeepSeek'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'DeepSeek V3',
			model: 'deepseek-chat',
			apiKey: '',
			baseUrl: 'https://api.deepseek.com/beta',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.url = `${this._config.baseUrl}/completions`;
	}
}

class VertexLegacyCompletion extends MistralCompletion {
	authInstance: GoogleAuth;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'vertex-legacy',
			displayName: 'Google Vertex (OpenAI Legacy API)'
		},
		supportedOptions: ['project', 'location'],
		defaults: {
			name: 'Codestral (Google Vertex)',
			model: 'codestral-2501',
			project: undefined,
			location: undefined,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);

		const model = this._config.model;

		const project = loadSetting({
			settingValue: this._config.project,
			settingName: 'project',
			environmentVariableName: 'GOOGLE_VERTEX_PROJECT',
			description: 'Google Vertex project',
		});

		const location = loadSetting({
			settingValue: this._config.location,
			settingName: 'location',
			environmentVariableName: 'GOOGLE_VERTEX_LOCATION',
			description: 'Google Vertex location',
		});

		this.authInstance = new GoogleAuth({
			scopes: ['https://www.googleapis.com/auth/cloud-platform'],
			projectId: project,
		});

		this.url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/mistralai/models/${model}:rawPredict`;
	}

	async getAccessToken() {
		const client = await this.authInstance.getClient();
		const accessToken = await client.getAccessToken();

		if (!accessToken || !accessToken.token) {
			const statusText = accessToken?.res?.statusText;
			throw new Error(`Google Cloud Authentication failed: ${statusText}`);
		}

		return accessToken.token;
	}
}

//#endregion
//#region Ollama API

class OllamaCompletion extends CompletionModel {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
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
		token.onCancellationRequested(() => controller.abort());

		const { textStream } = await ai.streamText({
			model: this.model,
			prompt: `<|fim_prefix|>${prevLines}\n${prefix}<|fim_suffix|>${suffix}\n${nextLines}\n<|fim_middle|>`,
			maxTokens: 64,
			abortSignal: signal,
		});

		let text = '';
		for await (const delta of textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			text += delta;
		}

		return [{ insertText: text }];
	}
}

//#endregion
//#region FIM Prompt
// (Anthropic, OpenAI, Bedrock, OpenRouter, Gemini, Azure)

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
		const filename = document.fileName;
		const { prefix, suffix, prevLines, nextLines } = this.getDocumentContext(document, position);

		const controller = new AbortController();
		const signal = controller.signal;
		token.onCancellationRequested(() => controller.abort());

		const system: string = await fs.promises.readFile(`${mdDir}/prompts/completion/fim.md`, 'utf8');
		const { textStream } = await ai.streamText({
			model: this.model,
			system: system,
			messages: [{ role: 'user', content: `<prefix>${prevLines}\n${prefix}</prefix><suffix>${suffix}\n${nextLines}</suffix>` }],
			maxTokens: 128,
			abortSignal: signal,
		});

		let text = '';
		for await (const delta of textStream) {
			if (token.isCancellationRequested) {
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
		type: positron.PositronLanguageModelType.Completion,
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
		type: positron.PositronLanguageModelType.Completion,
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
		type: positron.PositronLanguageModelType.Completion,
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

class AWSCompletion extends FimPromptCompletion {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
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

class VertexCompletion extends FimPromptCompletion {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'vertex',
			displayName: 'Google Vertex'
		},
		supportedOptions: ['project', 'location'],
		defaults: {
			name: 'Gemini 1.5 Flash',
			model: 'gemini-1.5-flash-002',
			project: undefined,
			location: undefined,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createVertex({
			project: this._config.project,
			location: this._config.location,
		})(this._config.model);
	}
}

class AzureCompletion extends FimPromptCompletion {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'azure',
			displayName: 'Azure'
		},
		supportedOptions: ['resourceName', 'apiKey'],
		defaults: {
			name: 'GPT 4o',
			model: 'gpt-4o',
			resourceName: undefined,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createAzure({
			apiKey: this._config.apiKey,
			resourceName: this._config.resourceName
		})(this._config.model);
	}
}

//#endregion
//#region Module exports

export function newCompletionProvider(config: ModelConfig): vscode.InlineCompletionItemProvider {
	const providerClasses = {
		'anthropic': AnthropicCompletion,
		'azure': AzureCompletion,
		'bedrock': AWSCompletion,
		'deepseek': DeepSeekCompletion,
		'mistral': MistralCompletion,
		'ollama': OllamaCompletion,
		'openai': OpenAICompletion,
		'openai-legacy': OpenAILegacyCompletion,
		'openrouter': OpenRouterCompletion,
		'vertex': VertexCompletion,
		'vertex-legacy': VertexLegacyCompletion,
	};

	if (!(config.provider in providerClasses)) {
		throw new Error(`Unsupported completion provider: ${config.provider}`);
	}

	return new providerClasses[config.provider as keyof typeof providerClasses](config);
}

export const completionModels = [
	AnthropicCompletion,
	AWSCompletion,
	AzureCompletion,
	DeepSeekCompletion,
	MistralCompletion,
	OllamaCompletion,
	OpenAICompletion,
	OpenAILegacyCompletion,
	OpenRouterCompletion,
	VertexCompletion,
	VertexLegacyCompletion,
];

//#endregion
