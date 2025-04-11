/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { ModelConfig } from './config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createVertex } from '@ai-sdk/google-vertex';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import { createOllama } from 'ollama-ai-provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { replaceBinaryMessageParts, toAIMessage } from './utils';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AnthropicLanguageModel } from './anthropic';

/**
 * Models used by chat participants and for vscode.lm.* API functionality.
 */

//#region Test Models
class ErrorLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Error Language Model';
	readonly provider = 'error';
	readonly identifier = 'error-language-model';
	private readonly _message = 'This language model always throws an error message.';

	static source = {
		type: positron.PositronLanguageModelType.Chat,
		signedIn: false,
		provider: {
			id: 'error',
			displayName: 'Error Language Model',
		},
		supportedOptions: [],
		defaults: {
			name: 'Error Language Model',
			model: 'error',
		},
	};

	getProviderDisplayName(): string {
		return ErrorLanguageModel.source.provider.displayName;
	}

	provideLanguageModelResponse(): Promise<any> {
		throw new Error(this._message);
	}

	provideTokenCount(): Promise<number> {
		throw new Error(this._message);
	}

	resolveConnection(token: vscode.CancellationToken): Thenable<Error | undefined> {
		throw new Error(this._message);
	}
}

class EchoLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Echo Language Model';
	readonly provider = 'echo';
	readonly identifier = 'echo-language-model';

	static source = {
		type: positron.PositronLanguageModelType.Chat,
		signedIn: false,
		provider: {
			id: 'echo',
			displayName: 'Echo Language Model',
		},
		supportedOptions: [],
		defaults: {
			name: 'Echo Language Model',
			model: 'echo',
		},
	};

	getProviderDisplayName(): string {
		return EchoLanguageModel.source.provider.displayName;
	}

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

	resolveConnection(token: vscode.CancellationToken): Thenable<Error | undefined> {
		return Promise.resolve(undefined);
	}
}

//#endregion
//#region Language Models

abstract class AILanguageModel implements positron.ai.LanguageModelChatProvider {
	public readonly name;
	public readonly provider;
	public readonly providerDisplayName;
	public readonly identifier;
	protected abstract model: ai.LanguageModelV1;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.id;
		this.name = _config.name;
		this.provider = _config.provider;
		this.providerDisplayName = this.getProviderDisplayName();
	}

	abstract getProviderDisplayName(): string;

	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		token.onCancellationRequested(() => {
			return false;
		});

		try {
			// send a test message to the model
			const result = await ai.generateText({
				model: this.model,
				prompt: 'I\'m checking to see if you\'re there. Response only with the word "hello".',
			});

			// if the model responds, the config works
			return undefined;
		} catch (error) {
			if (ai.AISDKError.isInstance(error)) {
				return new Error(error.message);
			}
			else {
				return new Error(JSON.stringify(error));
			}
		}
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
		token.onCancellationRequested(() => controller.abort());

		let tools: Record<string, ai.Tool> | undefined;

		// Replace embedded binary references with message part types compatible with vercel AI
		const _messages = replaceBinaryMessageParts(
			toAIMessage(messages),
			options.modelOptions?.binaryReferences ?? {}
		);

		if (options.tools && options.tools.length > 0) {
			tools = options.tools.reduce((acc: Record<string, ai.Tool>, tool: vscode.LanguageModelChatTool) => {
				acc[tool.name] = ai.tool({
					description: tool.description,
					parameters: ai.jsonSchema(tool.inputSchema ?? { type: 'object', properties: {} }),
				});
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
				break;
			}

			if (part.type === 'reasoning') {
				progress.report({
					index: 0,
					part: new vscode.LanguageModelTextPart(part.textDelta)
				});
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
				// TODO: Deal with various LLM providers' different error response formats
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

class AnthropicAILanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

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

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createAnthropic({ apiKey: this._config.apiKey })(this._config.model);
	}

	getProviderDisplayName(): string {
		return AnthropicAILanguageModel.source.provider.displayName;
	}
}

class OpenAILanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'openai',
			displayName: 'OpenAI'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'GPT-4o',
			model: 'gpt-4o',
			baseUrl: 'https://api.openai.com/v1',
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

	getProviderDisplayName(): string {
		return OpenAILanguageModel.source.provider.displayName;
	}
}

class MistralLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'mistral',
			displayName: 'Mistral'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'Pixtral Large',
			model: 'pixtral-large-latest',
			baseUrl: 'https://api.mistral.ai/v1',
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createMistral({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		})(this._config.model);
	}

	getProviderDisplayName(): string {
		return MistralLanguageModel.source.provider.displayName;
	}
}

class OpenRouterLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
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

	getProviderDisplayName(): string {
		return OpenRouterLanguageModel.source.provider.displayName;
	}
}

class OllamaLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'ollama',
			displayName: 'Ollama'
		},
		supportedOptions: ['baseUrl', 'toolCalls', 'numCtx'],
		defaults: {
			name: 'Qwen 2.5',
			model: 'qwen2.5-coder:7b',
			baseUrl: 'http://localhost:11434/api',
			toolCalls: false,
			numCtx: 2048,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOllama({ baseURL: this._config.baseUrl })(this._config.model, {
			numCtx: this._config.numCtx,
		});
	}

	getProviderDisplayName(): string {
		return OllamaLanguageModel.source.provider.displayName;
	}
}

class AzureLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'azure',
			displayName: 'Azure'
		},
		supportedOptions: ['resourceName', 'apiKey', 'toolCalls'],
		defaults: {
			name: 'GPT 4o',
			model: 'gpt-4o',
			resourceName: undefined,
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createAzure({
			apiKey: this._config.apiKey,
			resourceName: this._config.resourceName
		})(this._config.model);
	}

	getProviderDisplayName(): string {
		return AzureLanguageModel.source.provider.displayName;
	}
}

class VertexLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'vertex',
			displayName: 'Google Vertex AI'
		},
		supportedOptions: ['toolCalls', 'project', 'location'],
		defaults: {
			name: 'Gemini 2.0 Flash',
			model: 'gemini-2.0-flash-exp',
			project: undefined,
			location: undefined,
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createVertex({
			project: this._config.project,
			location: this._config.location,
		})(this._config.model);
	}

	getProviderDisplayName(): string {
		return VertexLanguageModel.source.provider.displayName;
	}
}

export class AWSLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'bedrock',
			displayName: 'AWS Bedrock'
		},
		supportedOptions: ['toolCalls'],
		defaults: {
			name: 'Claude 3.5 Sonnet v2',
			model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig) {
		super(_config);

		this.model = createAmazonBedrock({
			bedrockOptions: {
				region: 'us-east-1',
				credentials: fromNodeProviderChain(),
			}
		})(this._config.model);
	}

	getProviderDisplayName(): string {
		return AWSLanguageModel.source.provider.displayName;
	}
}

//#endregion
//#region Module exports
export function getLanguageModels() {
	const testLanguageModels = [
		AWSLanguageModel,
		EchoLanguageModel,
		ErrorLanguageModel,
	];

	// Check if the user disabled the Anthropic SDK. This is for development purposes.
	const useAnthropicSdk = vscode.workspace.getConfiguration('positron.assistant').get('useAnthropicSdk', true);
	const anthropicClass = useAnthropicSdk ? AnthropicLanguageModel : AnthropicAILanguageModel;

	const languageModels = [
		...testLanguageModels,
		anthropicClass,
		AzureLanguageModel,
		GoogleLanguageModel,
		MistralLanguageModel,
		OllamaLanguageModel,
		OpenAILanguageModel,
		OpenRouterLanguageModel,
		VertexLanguageModel,
	];
	return languageModels;
}

export function newLanguageModel(config: ModelConfig): positron.ai.LanguageModelChatProvider {
	const providerClass = getLanguageModels().find((cls) => cls.source.provider.id === config.provider);
	if (!providerClass) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}
	return new providerClass(config);
}

class GoogleLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected model: ai.LanguageModelV1;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'google',
			displayName: 'Gemini Code Assist'
		},
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'Gemini 2.0 Flash',
			model: 'gemini-2.0-flash-exp',
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

	getProviderDisplayName(): string {
		return GoogleLanguageModel.source.provider.displayName;
	}
}
