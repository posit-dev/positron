/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import * as fs from 'fs';

import { ModelConfig } from './config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { MD_DIR } from './constants';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { createVertex } from '@ai-sdk/google-vertex';
import { createAzure } from '@ai-sdk/azure';

import { loadSetting } from '@ai-sdk/provider-utils';
import { GoogleAuth } from 'google-auth-library';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { CopilotService } from './copilot.js';

/**
 * Models used for autocomplete/ghost text.
 *
 * A minor complication here is that there does not yet seem to be a universally agreed-upon FIM
 * completions API. OpenAI has a completions API, but it is considered legacy and does not work with
 * their latest models. Yet, some other providers still implement it for newer models.
 *
 * Other providers do not make available completion models or endpoints. For those providers we
 * emulate a FIM API with prompt engineering.
 */

//#region Document context

let recentFiles: string[] = [];
const RECENT_FILES_KEY = 'positron-assistant.recentFiles';
const MAX_HISTORY = 10;
const WINDOW_SIZE = 50;

export function registerHistoryTracking(context: vscode.ExtensionContext) {
	recentFiles = context.workspaceState.get(RECENT_FILES_KEY, []);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(document => {
			if (document.uri.scheme !== 'file') {
				return;
			}

			const path = document.uri.fsPath;
			recentFiles = recentFiles.filter(f => f !== path);
			recentFiles.unshift(path);

			if (recentFiles.length > MAX_HISTORY) {
				recentFiles = recentFiles.slice(0, MAX_HISTORY);
			}
			context.workspaceState.update(RECENT_FILES_KEY, recentFiles);
		})
	);
}

async function getRelatedContext(document: vscode.TextDocument) {
	// Ensure recent files are open and available as text documents, if possible
	await Promise.all(recentFiles.map(async (path) => {
		try {
			return await vscode.workspace.openTextDocument(path);
		} catch (error) {
			return null;
		}
	}));

	// Of the other documents now available, we only want type `file` with matching language ID
	const documents = vscode.workspace.textDocuments
		.filter((doc) => doc.uri.scheme === 'file')
		.filter((doc) => doc.languageId === document.languageId)
		.filter((doc) => doc.uri !== document.uri);

	// Slide a window over the contents of the remaining documents and return best matching section
	return Object.fromEntries(
		// Use async map to yield and avoid blocking
		await Promise.all(documents.map(async (doc) => {
			const best: { range?: vscode.Range; score: number } = { score: 0 };
			for (let low = 0; low < doc.lineCount; low += Math.floor(WINDOW_SIZE / 2)) {
				const high = Math.min(low + WINDOW_SIZE, doc.lineCount);
				const range = new vscode.Range(low, 0, high, 0);
				const score = textSimilarityScore(document.getText(), doc.getText(range));
				if (score > best.score) {
					best.score = score;
					best.range = range;
				}
			}
			return [doc.uri.fsPath, doc.getText(best.range)];
		}))
	);
}

function textSimilarityScore(text: string, window: string): number {
	// Compute the Jaccard similarity coefficient
	// TODO: Consider calculating TF-IDF and scoring via cosine similarity.
	const set1 = new Set(text.split(/\s+/).filter((word) => !!word));
	const set2 = new Set(window.split(/\s+/).filter((word) => !!word));

	const intersection = new Set([...set1].filter(x => set2.has(x)));
	const union = new Set([...set1, ...set2]);
	return union.size === 0 ? 1 : intersection.size / union.size;
}

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

	async getDocumentContext(document: vscode.TextDocument, position: vscode.Position) {
		// Windows of best-matching text from recent related documents
		const related = await getRelatedContext(document);

		// Characters before and after the cursor on this line
		const curPrefix = document.lineAt(position.line).text.substring(0, position.character);
		const curSuffix = document.lineAt(position.line).text.substring(position.character);

		// Lines before and after the current line
		const prevLines = Array.from({ length: position.line }, (_, i) => {
			return document.lineAt(i).text;
		}).join('\n');
		const nextLines = Array.from({ length: document.lineCount - position.line - 1 }, (_, i) => {
			return document.lineAt(position.line + i + 1).text;
		}).join('\n');

		// Trim the prefix and suffix to avoid going over provider and model token limits.
		// We trim the suffix smaller to make room for additional document context.
		// TODO: There should be some way to configure these limits, based on model capability.
		const prefix = `${prevLines}\n${curPrefix}`.slice(-3072);
		const suffix = `${curSuffix}\n${nextLines}`.slice(0, 1024);

		return { related, prefix, suffix };
	}
}

//#endregion
//#region OpenAI Legacy API
// (OpenAI FIM, DeepSeek, Mistral, Ollama)

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
		// Check if the file should be excluded from AI features
		if (!await positron.ai.areCompletionsEnabled(document.uri)) {
			return [];
		}

		// Delay a little before hitting the network, we might be cancelled by further keystrokes
		await new Promise(resolve => setTimeout(resolve, 200));

		if (token.isCancellationRequested) {
			return [];
		}

		const { related, prefix, suffix } = await this.getDocumentContext(document, position);
		const relatedText = Object.values(related).join('\n');

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
				prompt: `${relatedText}\n${prefix}`,
				suffix: suffix,
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

		const completions = new vscode.InlineCompletionList(
			data.choices.map((choice) => {
				const item = new vscode.InlineCompletionItem(
					'text' in choice ? choice.text : choice.message.content
				);
				item.completeBracketPairs = true;
				return item;
			})
		);
		completions.enableForwardStability = true;
		return completions;
	}
}

class MistralCompletion extends OpenAILegacyCompletion {
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'mistral',
			displayName: 'Mistral AI'
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

class OllamaCompletion extends OpenAILegacyCompletion {
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'ollama',
			displayName: 'Ollama'
		},
		supportedOptions: ['baseUrl'],
		defaults: {
			name: 'Qwen 2.5 Base (3b)',
			model: 'qwen2.5-coder:3b-base',
			baseUrl: 'http://localhost:11434/api',
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.url = `${this._config.baseUrl?.replace(/\/api$/, '')}/v1/completions`;
	}

	async getAccessToken() {
		return '';
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
		// Check if the file should be excluded from AI features
		if (!await positron.ai.areCompletionsEnabled(document.uri)) {
			return [];
		}

		// Delay a little before hitting the network, we might be cancelled by further keystrokes
		await new Promise(resolve => setTimeout(resolve, 200));

		if (token.isCancellationRequested) {
			return [];
		}

		const { related, prefix, suffix } = await this.getDocumentContext(document, position);
		const relatedText = Object.entries(related).map(([filename, text]) => {
			return `<|file_separator|>${filename}\n${text}\n`;
		}).join('\n');

		const controller = new AbortController();
		const signal = controller.signal;
		token.onCancellationRequested(() => controller.abort());

		const system: string = await fs.promises.readFile(`${MD_DIR}/prompts/completion/fim.md`, 'utf8');
		const { textStream } = await ai.streamText({
			model: this.model,
			system: system,
			messages: [
				{ role: 'user', content: `${relatedText}\n<|file_separator|>${document.fileName}\n<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}\n<|fim_middle|>` }
			],
			maxTokens: 128,
			temperature: 0.2,
			stopSequences: ['\n\n', '<|fim_prefix|>', '<|fim_suffix|>', '<|file_separator|>'],
			abortSignal: signal,
		});

		let text = '';
		for await (const delta of textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			text += delta;
		}

		const completion = new vscode.InlineCompletionItem(text);
		completion.completeBracketPairs = true;

		const completions = new vscode.InlineCompletionList([completion]);
		completions.enableForwardStability = true;
		return completions;
	}
}

class AnthropicCompletion extends FimPromptCompletion {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'anthropic-api',
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
			name: 'GPT-4.1 Mini',
			model: 'gpt-4.1-mini',
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
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'amazon-bedrock',
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

		// Cast to ai.LanguageModelV1 to satisfy base class type
		this.model = createAmazonBedrock({
			credentialProvider: fromNodeProviderChain(),
		})(this._config.model) as unknown as ai.LanguageModelV1;
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

class GoogleCompletion extends FimPromptCompletion {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'google',
			displayName: 'Google Generative AI'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'Gemini 2.0 Flash',
			model: 'gemini-2.0-flash-001',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			apiKey: undefined,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createGoogleGenerativeAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
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

export class CopilotCompletion implements vscode.InlineCompletionItemProvider {
	public name;
	public identifier;
	private readonly _copilotService;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Completion,
		provider: {
			id: 'copilot',
			displayName: 'GitHub Copilot'
		},
		supportedOptions: ['oauth'],
		defaults: {
			name: 'GitHub Copilot',
			model: 'github-copilot',
			oauth: true,
		},
	};

	constructor(_config: ModelConfig) {
		this.identifier = _config.id;
		this.name = _config.name;
		this._copilotService = CopilotService.instance();
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
		// Check if the file should be excluded from AI features
		if (!await positron.ai.areCompletionsEnabled(document.uri)) {
			return [];
		}
		return await this._copilotService.inlineCompletion(document, position, context, token);
	}

	handleDidPartiallyAcceptCompletionItem(completionItem: vscode.InlineCompletionItem, infoOrAcceptedLength: vscode.PartialAcceptInfo | number): void {
		const acceptedLength = typeof infoOrAcceptedLength === 'number' ? infoOrAcceptedLength : infoOrAcceptedLength.acceptedLength;
		this._copilotService.didPartiallyAcceptCompletionItem(completionItem, acceptedLength);
	}

	handleDidShowCompletionItem(completionItem: vscode.InlineCompletionItem, updatedInsertText: string): void {
		this._copilotService.didShowCompletionItem(completionItem, updatedInsertText);
	}
}

//#endregion
//#region Module exports

export function newCompletionProvider(config: ModelConfig): vscode.InlineCompletionItemProvider {
	const providerClasses = {
		'anthropic-api': AnthropicCompletion,
		'azure': AzureCompletion,
		'amazon-bedrock': AWSCompletion,
		'copilot': CopilotCompletion,
		'deepseek': DeepSeekCompletion,
		'google': GoogleCompletion,
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
	CopilotCompletion,
	DeepSeekCompletion,
	MistralCompletion,
	GoogleCompletion,
	OllamaCompletion,
	OpenAICompletion,
	OpenAILegacyCompletion,
	OpenRouterCompletion,
	VertexCompletion,
	VertexLegacyCompletion,
];

//#endregion
