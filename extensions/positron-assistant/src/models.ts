/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { ModelConfig } from './config';
import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import { AzureOpenAIProvider, createAzure } from '@ai-sdk/azure';
import { createVertex, GoogleVertexProvider } from '@ai-sdk/google-vertex';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { createMistral, MistralProvider } from '@ai-sdk/mistral';
import { createOllama, OllamaProvider } from 'ollama-ai-provider';
import { createOpenRouter, OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import { markBedrockCacheBreakpoint, processMessages, toAIMessage } from './utils';
import { AmazonBedrockProvider, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AnthropicLanguageModel } from './anthropic';
import { DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { log, recordRequestTokenUsage, recordTokenUsage } from './extension.js';
import { TokenUsage } from './tokens.js';

/**
 * Models used by chat participants and for vscode.lm.* API functionality.
 */

//#region Test Models
class ErrorLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Error Language Model';
	readonly provider = 'error';
	readonly id = 'error-language-model';
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;
	private readonly _message = 'This language model always throws an error message.';

	constructor(
		_config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext
	) {
		// No additional setup needed for error model
	}

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

	get providerName(): string {
		return ErrorLanguageModel.source.provider.displayName;
	}

	provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
		throw new Error(this._message);
	}

	provideLanguageModelChatResponse(): Promise<any> {
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
	readonly id = 'echo-language-model';
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;

	constructor(
		_config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext
	) {
		// No additional setup needed for echo model
	}

	static source = {
		type: positron.PositronLanguageModelType.Chat,
		signedIn: false,
		provider: {
			id: 'echo',
			displayName: 'Echo',
		},
		supportedOptions: [],
		defaults: {
			name: 'Echo Language Model',
			model: 'echo',
		},
	};

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	get providerName(): string {
		return EchoLanguageModel.source.provider.displayName;
	}

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken): Promise<any[]> {
		return [
			{
				id: this.id,
				name: this.name,
				family: this.provider,
				version: '1.0.0',
				maxInputTokens: 0,
				maxOutputTokens: this.maxOutputTokens,
				capabilities: this.capabilities,
				isDefault: true,
				isUserSelectable: true,
			} satisfies vscode.LanguageModelChatInformation
		];
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage[],
		options: { [name: string]: any },
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<any> {
		const _messages = toAIMessage(messages);
		const message = _messages.length > 1 ? _messages[_messages.length - 2] : _messages[0]; // Get the last user message, the last message is the context

		if (typeof message.content === 'string') {
			message.content = [{ type: 'text', text: message.content }];
		}

		if (message.content[0].type !== 'text') {
			throw new Error('Echo language model only supports text messages.');
		}

		const inputText = message.content[0].text;
		let response: string;

		// Check for known test commands and respond accordingly
		if (inputText === 'Send Python Code') {
			response = '```python\nfoo = 100\n```';
		}
		else if (inputText === 'Send R Code') {
			response = '```r\nfoo <- 200\n```';
		}
		else {
			// Default case: echo back the input message
			response = inputText;
		}

		let tokenUsage;

		// Record token usage if context is available
		if (this._context) {
			const inputTokens = await this.provideTokenCount(model, inputText, token);
			const outputTokens = await this.provideTokenCount(model, response, token);
			tokenUsage = { inputTokens, outputTokens, cachedTokens: 0 };
			recordTokenUsage(this._context, this.provider, tokenUsage);
			// Also record token usage by request ID if available
			const requestId = (options.modelOptions as any)?.requestId;
			if (requestId) {
				recordRequestTokenUsage(requestId, this.provider, tokenUsage);
			}
		}

		// Output the response character by character
		for await (const i of response.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			progress.report(new vscode.LanguageModelTextPart(i));
			if (token.isCancellationRequested) {
				return;
			}
		}

		return { tokenUsage };
	}

	async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Promise<number> {
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
	public readonly id;
	protected abstract aiProvider: (id: string, options?: Record<string, any>) => ai.LanguageModelV1;
	protected aiOptions: Record<string, any> = {};

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	constructor(
		protected readonly _config: ModelConfig,
		protected readonly _context?: vscode.ExtensionContext
	) {
		this.id = _config.id;
		this.name = _config.name;
		this.provider = _config.provider;
	}

	get providerName(): string {
		return this.providerName;
	}

	getMaxOutputTokens(id: string): number {
		let maxOutputTokens = this._config.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT;

		// Override using fixed model list if available
		const fixedModels = availableModels.get(this._config.provider);
		maxOutputTokens = fixedModels?.find(m => m.identifier === id)?.maxOutputTokens ?? maxOutputTokens;

		// Override maxOutputTokens if specified in the configuration
		const maxOutputTokensConfig: Record<string, number> = vscode.workspace.getConfiguration('positron.assistant').get('maxOutputTokens', {});
		for (const [key, value] of Object.entries(maxOutputTokensConfig)) {
			if (id.indexOf(key) !== -1 && value) {
				if (typeof value !== 'number') {
					log.warn(`Invalid maxOutputTokens '${value}' for ${key} (${id}); ignoring`);
					continue;
				}
				if (value < 512) {
					log.warn(`Specified maxOutputTokens '${value}' for ${key} (${id}) is too low; using 512 instead`);
					maxOutputTokens = 512;
				}
				maxOutputTokens = value;
				break;
			}
		}

		log.debug(`Setting maxOutputTokens for (${id}) to ${maxOutputTokens}`);
		return maxOutputTokens;
	}

	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		token.onCancellationRequested(() => {
			return false;
		});

		try {
			// send a test message to the model
			const result = await ai.generateText({
				model: this.aiProvider(this._config.model, this.aiOptions),
				prompt: 'I\'m checking to see if you\'re there. Response only with the word "hello".',
			});

			// if the model responds, the config works
			return undefined;
		} catch (error) {
			const providerErrorMessage = this.parseProviderError(error);
			if (providerErrorMessage) {
				return new Error(providerErrorMessage);
			}
			if (ai.AISDKError.isInstance(error)) {
				return new Error(error.message);
			}
			else {
				return new Error(JSON.stringify(error));
			}
		}
	}

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		// Prepare the language model chat information
		const providerId = this._config.provider;
		const models = availableModels.get(providerId);

		if (!models || models.length === 0) {
			const aiModel = this.aiProvider(this._config.model, this.aiOptions);
			return [
				{
					id: aiModel.modelId,
					name: this.name,
					family: aiModel.provider,
					version: aiModel.specificationVersion,
					maxInputTokens: 0,
					maxOutputTokens: this.getMaxOutputTokens(aiModel.modelId),
					capabilities: this.capabilities,
					isDefault: true,
					isUserSelectable: true,
				} satisfies vscode.LanguageModelChatInformation
			];
		}

		// Return the available models for this provider
		// The first model is the default model
		const languageModels: vscode.LanguageModelChatInformation[] = models.map(m => {
			const aiModel = this.aiProvider(m.identifier);
			return {
				id: m.identifier,
				name: m.name,
				family: aiModel.provider,
				version: aiModel.specificationVersion,
				maxInputTokens: 0,
				maxOutputTokens: this.getMaxOutputTokens(aiModel.modelId),
				capabilities: this.capabilities,
				// is default if it's the first model out of models
				isDefault: m === models[0],
				isUserSelectable: true,
			};
		});

		return languageModels;
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	) {
		const aiModel = this.aiProvider(model.id);
		const modelOptions = options.modelOptions ?? {};

		const controller = new AbortController();
		const signal = controller.signal;
		token.onCancellationRequested(() => controller.abort());

		let tools: Record<string, ai.Tool> | undefined;

		// Ensure all messages have content
		const processedMessages = processMessages(messages);
		// Only Anthropic currently supports experimental_content in tool
		// results.
		const toolResultExperimentalContent = this.provider === 'anthropic-api' ||
			aiModel.modelId.startsWith('us.anthropic');

		// Only select Bedrock models support cache breakpoints; specifically,
		// the Claude 3.5 Sonnet models don't support them.
		//
		// Consider: it'd be more verbose but we should consider including this information
		// in the hardcoded model metadata in the model config.
		const bedrockCacheBreakpoint = this.provider === 'amazon-bedrock' &&
			!aiModel.modelId.startsWith('us.anthropic.claude-3-5');

		const aiMessages: ai.CoreMessage[] = [];

		// The system message we will send to the model.
		let systemMessage: string | undefined = modelOptions.system;

		if (bedrockCacheBreakpoint && systemMessage) {
			// Add the system prompt as the first message if we have a system
			// prompt and cache breakpoints are enabled.
			//
			// This must be done in order to set a cache breakpoint for the
			// system message. In general we prefer to send the system message
			// using the 'system' option in streamText; see the
			// CoreSystemMessage documentation for a detailed explanation.
			const aiSystemMessage: ai.CoreSystemMessage = {
				role: 'system',
				content: systemMessage,
			};
			markBedrockCacheBreakpoint(aiSystemMessage);
			aiMessages.push(aiSystemMessage);

			// Consume the system message so it doesn't get sent a second time
			systemMessage = undefined;
		}

		// Convert all other messages to the Vercel AI format.
		aiMessages.push(...toAIMessage(processedMessages, toolResultExperimentalContent,
			bedrockCacheBreakpoint));

		if (options.tools && options.tools.length > 0) {
			tools = options.tools.reduce((acc: Record<string, ai.Tool>, tool: vscode.LanguageModelChatTool) => {
				acc[tool.name] = ai.tool({
					description: tool.description,
					parameters: ai.jsonSchema(tool.inputSchema ?? { type: 'object', properties: {} }),
				});
				return acc;
			}, {});
		}

		const modelTools = this._config.toolCalls ? tools : undefined;
		const requestId = (options.modelOptions as any)?.requestId;

		log.info(`[vercel] Start request ${requestId} to ${this._config.name} [${aiModel.modelId}]: ${aiMessages.length} messages`);
		log.debug(`[${this._config.name}] SEND ${aiMessages.length} messages, ${modelTools ? Object.keys(modelTools).length : 0} tools`);
		if (modelTools) {
			log.trace(`tools: ${modelTools ? Object.keys(modelTools).join(', ') : '(none)'}`);
		}
		if (systemMessage) {
			log.trace(`system: ${systemMessage.length > 100 ? `${systemMessage.substring(0, 100)}...` : systemMessage} (${systemMessage.length} chars)`);
		}
		log.trace(`messages: ${JSON.stringify(aiMessages, null, 2)}`);
		const result = ai.streamText({
			model: aiModel,
			system: systemMessage,
			messages: aiMessages,
			maxSteps: modelOptions.maxSteps ?? 50,
			tools: modelTools,
			abortSignal: signal,
			maxTokens: this.getMaxOutputTokens(aiModel.modelId),
		});

		let accumulatedTextDeltas: string[] = [];

		const flushAccumulatedTextDeltas = () => {
			if (accumulatedTextDeltas.length > 0) {
				const combinedText = accumulatedTextDeltas.join('');
				log.trace(`[${this._config.name}] RECV text-delta (${accumulatedTextDeltas.length} parts): ${combinedText}`);
				accumulatedTextDeltas = [];
			}
		};

		for await (const part of result.fullStream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (part.type === 'reasoning') {
				flushAccumulatedTextDeltas();
				log.trace(`[${this._config.name}] RECV reasoning: ${part.textDelta}`);
				progress.report(new vscode.LanguageModelTextPart(part.textDelta));
			}

			if (part.type === 'text-delta') {
				accumulatedTextDeltas.push(part.textDelta);
				progress.report(new vscode.LanguageModelTextPart(part.textDelta));
			}

			if (part.type === 'tool-call') {
				flushAccumulatedTextDeltas();
				log.trace(`[${this._config.name}] RECV tool-call: ${part.toolCallId} (${part.toolName}) with args: ${JSON.stringify(part.args)}`);
				progress.report(new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, part.args));
			}

			if (part.type === 'error') {
				flushAccumulatedTextDeltas();
				log.warn(`[${this._config.name}] RECV error: ${JSON.stringify(part.error)}`);

				const providerErrorMessage = this.parseProviderError(part.error);
				if (providerErrorMessage) {
					throw new Error(providerErrorMessage);
				}

				if (typeof part.error === 'string') {
					throw new Error(part.error);
				}
				throw new Error(JSON.stringify(part.error));
			}
		}

		// Flush any remaining accumulated text deltas
		flushAccumulatedTextDeltas();

		// Log all the warnings from the response
		result.warnings.then((warnings) => {
			if (warnings) {
				for (const warning of warnings) {
					log.warn(`[${aiModel.modelId}] (${this.id}) warn: ${warning}`);
				}
			}
		});

		// ai-sdk provides token usage in the result but it's not clear how it is calculated
		const usage = await result.usage;
		const metadata = await result.providerMetadata;
		const tokens: TokenUsage = {
			inputTokens: usage.promptTokens,
			outputTokens: usage.completionTokens,
			cachedTokens: 0,
			providerMetadata: metadata,
		};

		// Log Bedrock usage if available
		if (metadata && metadata.bedrock && metadata.bedrock.usage) {
			// Get the Bedrock usage object; it typically contains
			// `cacheReadInputTokens` and `cacheWriteInputTokens`
			const metaUsage = metadata.bedrock.usage as Record<string, any>;

			// Update the usage to take into account cache hits
			tokens.inputTokens += metaUsage.cacheWriteInputTokens || 0;
			tokens.cachedTokens += metaUsage.cacheReadInputTokens || 0;

			// Report token usage information as part of the output stream.
			const part: any = vscode.LanguageModelDataPart.json({ type: 'usage', data: tokens });
			progress.report(part);

			// Log the Bedrock usage
			log.debug(`[${this._config.name}]: Bedrock usage: ${JSON.stringify(usage, null, 2)}`);
		}

		if (requestId) {
			recordRequestTokenUsage(requestId, this.provider, tokens);
		}

		if (this._context) {
			recordTokenUsage(this._context, this.provider, tokens);
		}

		log.info(`[vercel]: End request ${requestId}; usage: ${tokens.inputTokens} input tokens (+${tokens.cachedTokens} cached), ${tokens.outputTokens} output tokens`);
	}

	async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2, token: vscode.CancellationToken): Promise<number> {
		// TODO: This is a naive approximation, a model specific tokenizer should be used.
		const len = typeof text === 'string' ? text.length : JSON.stringify(text.content).length;
		return Math.ceil(len / 4);
	}

	/**
	 * Parses for specific ai-sdk errors.
	 * @param error The error object returned by the provider.
	 * @returns A user-friendly error message or undefined if not specifically handled.
	 */
	parseProviderError(error: any): string | undefined {
		// Try to extract an API error message with ai-sdk
		if (ai.APICallError.isInstance(error)) {
			const responseBody = error.responseBody;
			if (responseBody) {
				try {
					const json = JSON.parse(responseBody);
					return `${json.message ?? JSON.stringify(json)}`;
				} catch (_error) {
					return `API Error: ${responseBody}`;
				}
			}
		}

		return undefined;
	}
}

class AnthropicAILanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: AnthropicProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			// Note: The 'anthropic' provider name is taken by Copilot Chat; we
			// use 'anthropic-api' instead to make it possible to differentiate
			// the two.
			id: 'anthropic-api',
			displayName: 'Anthropic'
		},
		supportedOptions: ['apiKey', 'apiKeyEnvVar'],
		defaults: {
			name: 'Claude 3.5 Sonnet v2',
			model: 'claude-3-5-sonnet-latest',
			toolCalls: true,
			apiKeyEnvVar: { key: 'ANTHROPIC_API_KEY', signedIn: false },
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createAnthropic({ apiKey: this._config.apiKey });
	}

	get providerName(): string {
		return AnthropicAILanguageModel.source.provider.displayName;
	}
}

class OpenAILanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: OpenAIProvider;

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
			completions: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createOpenAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	get providerName(): string {
		return OpenAILanguageModel.source.provider.displayName;
	}
}

class MistralLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: MistralProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'mistral',
			displayName: 'Mistral AI'
		},
		supportedOptions: ['apiKey', 'baseUrl'],
		defaults: {
			name: 'Mistral Medium',
			model: 'mistral-medium-latest',
			baseUrl: 'https://api.mistral.ai/v1',
			toolCalls: true,
			completions: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createMistral({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	get providerName(): string {
		return MistralLanguageModel.source.provider.displayName;
	}
}

class OpenRouterLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: OpenRouterProvider;

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

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createOpenRouter({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	get providerName(): string {
		return OpenRouterLanguageModel.source.provider.displayName;
	}
}

class OllamaLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: OllamaProvider;

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

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiOptions = {
			numCtx: this._config.numCtx,
		};
		this.aiProvider = createOllama({ baseURL: this._config.baseUrl });
	}

	get providerName(): string {
		return OllamaLanguageModel.source.provider.displayName;
	}
}

class AzureLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: AzureOpenAIProvider;

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

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createAzure({
			apiKey: this._config.apiKey,
			resourceName: this._config.resourceName
		});
	}

	get providerName(): string {
		return AzureLanguageModel.source.provider.displayName;
	}
}

class VertexLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: GoogleVertexProvider;

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

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createVertex({
			project: this._config.project,
			location: this._config.location,
		});
	}

	get providerName(): string {
		return VertexLanguageModel.source.provider.displayName;
	}
}

export class AWSLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: AmazonBedrockProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'amazon-bedrock',
			displayName: 'AWS Bedrock'
		},
		supportedOptions: ['toolCalls'],
		defaults: {
			name: 'Claude 3.5 Sonnet v2 Bedrock',
			model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);

		this.aiProvider = createAmazonBedrock({
			// AWS_ACCESS_KEY_ID, AWS_SESSION_TOKEN, and AWS_SECRET_ACCESS_KEY must be set
			// sets the AWS region where the models are available
			region: process.env.AWS_REGION ?? 'us-east-1',
			credentialProvider: fromNodeProviderChain(),
		});
	}

	get providerName(): string {
		return AWSLanguageModel.source.provider.displayName;
	}

	/**
	 * Parses the error returned by Bedrock.
	 * @param error The error object
	 * @returns A user-friendly error message or undefined if not specifically handled.
	 */
	override parseProviderError(error: any): string | undefined {
		const aiSdkError = super.parseProviderError(error);
		if (aiSdkError) {
			return aiSdkError;
		}

		if (!(error instanceof Error)) {
			return undefined;
		}

		const name = error.name;
		const message = error.message;

		if (!message) {
			return super.parseProviderError(error);
		}

		if (name === 'CredentialsProviderError') {
			return vscode.l10n.t(`Invalid AWS credentials. {0}`, message);
		}

		return vscode.l10n.t(`AWS Bedrock error: {0}`, message);
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

/**
 * Creates model configurations from environment variables.
 * Only compatible with providers that have an API key environment variable.
 *
 * @returns The model configurations that are configured by the environment.
 */
export function createModelConfigsFromEnv(): ModelConfig[] {
	const models = getLanguageModels();
	const modelConfigs: ModelConfig[] = [];

	models.forEach(model => {
		if ('apiKeyEnvVar' in model.source.defaults) {
			const key = model.source.defaults.apiKeyEnvVar?.key;
			const apiKey = key ? process.env[key] : undefined;

			if (key && apiKey) {
				const modelConfig = {
					id: `${model.source.provider.id}`,
					provider: model.source.provider.id,
					type: positron.PositronLanguageModelType.Chat,
					name: model.source.provider.displayName,
					model: model.source.defaults.model,
					apiKey: apiKey,
					apiKeyEnvVar: 'apiKeyEnvVar' in model.source.defaults ? model.source.defaults.apiKeyEnvVar : undefined,
				};
				modelConfigs.push(modelConfig);
			}
		}
	});

	return modelConfigs;
}

// export function newLanguageModel(config: ModelConfig, context: vscode.ExtensionContext): positron.ai.LanguageModelChatProvider {
export function newLanguageModelChatProvider(config: ModelConfig, context: vscode.ExtensionContext): positron.ai.LanguageModelChatProvider {
	const providerClass = getLanguageModels().find((cls) => cls.source.provider.id === config.provider);
	if (!providerClass) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}
	return new providerClass(config, context);
}

class GoogleLanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: GoogleGenerativeAIProvider;

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
			toolCalls: true,
			completions: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createGoogleGenerativeAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	get providerName(): string {
		return GoogleLanguageModel.source.provider.displayName;
	}
}

// Note: we don't query for available models using any provider API since it may return ones that are not
// suitable for chat and we don't want the selection to be too large
export const availableModels = new Map<string, { name: string; identifier: string; maxOutputTokens?: number }[]>(
	[
		['anthropic-api', [
			{
				name: 'Claude 4 Sonnet',
				identifier: 'claude-sonnet-4-20250514',
				maxOutputTokens: 64_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			},
			{
				name: 'Claude 4 Opus',
				identifier: 'claude-opus-4-20250514',
				maxOutputTokens: 32_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			},
			{
				name: 'Claude 3.7 Sonnet v1',
				identifier: 'claude-3-7-sonnet-latest',
				maxOutputTokens: 64_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			},
			{
				name: 'Claude 3.5 Sonnet v2',
				identifier: 'claude-3-5-sonnet-latest',
				maxOutputTokens: 8_192, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			},
		]],
		['google', [
			{
				name: 'Gemini 2.5 Flash',
				identifier: 'gemini-2.5-pro-exp-03-25',
				maxOutputTokens: 65_536, // reference: https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-preview
			},
			{
				name: 'Gemini 2.0 Flash',
				identifier: 'gemini-2.0-flash-exp',
				maxOutputTokens: 8_192, // reference: https://ai.google.dev/gemini-api/docs/models#gemini-2.0-flash
			},
			{
				name: 'Gemini 1.5 Flash 002',
				identifier: 'gemini-1.5-flash-002',
				maxOutputTokens: 8_192, // reference: https://ai.google.dev/gemini-api/docs/models#gemini-1.5-flash
			},
		]],
		['amazon-bedrock', [
			{
				name: 'Claude 4 Sonnet Bedrock',
				identifier: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
				maxOutputTokens: 8_192, // use more conservative value for Bedrock (up to 64K tokens available)
			},
			{
				name: 'Claude 4 Opus Bedrock',
				identifier: 'us.anthropic.claude-opus-4-20250514-v1:0',
				maxOutputTokens: 8_192, // use more conservative value for Bedrock (up to 32K tokens available)
			},
			{
				name: 'Claude 3.7 Sonnet v1 Bedrock',
				identifier: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
				maxOutputTokens: 8_192, // use more conservative value for Bedrock (up to 64K tokens available)
			},
			{
				name: 'Claude 3.5 Sonnet v2 Bedrock',
				identifier: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
				maxOutputTokens: 8_192, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			},
			{
				name: 'Claude 3.5 Sonnet v1 Bedrock',
				identifier: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
				maxOutputTokens: 8_192, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			},
		]]
	]
);
