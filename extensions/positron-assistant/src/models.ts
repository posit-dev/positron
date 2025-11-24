/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { getMaxConnectionAttempts, getProviderTimeoutMs, getEnabledProviders, ModelConfig, SecretStorage } from './config';
import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import { AzureOpenAIProvider, createAzure } from '@ai-sdk/azure';
import { createVertex, GoogleVertexProvider } from '@ai-sdk/google-vertex';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { createMistral, MistralProvider } from '@ai-sdk/mistral';
import { createOllama, OllamaProvider } from 'ollama-ai-provider';
import { createOpenRouter, OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import { processMessages, toAIMessage } from './utils';
import { AmazonBedrockProvider, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AnthropicLanguageModel, DEFAULT_ANTHROPIC_MODEL_MATCH, DEFAULT_ANTHROPIC_MODEL_NAME } from './anthropic';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT, IS_RUNNING_ON_PWB } from './constants.js';
import { log, recordRequestTokenUsage, recordTokenUsage } from './extension.js';
import { TokenUsage } from './tokens.js';
import { BedrockClient, FoundationModelSummary, InferenceProfileSummary, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { PositLanguageModel } from './posit.js';
import { applyModelFilters } from './modelFilters';
import { autoconfigureWithManagedCredentials, AWS_MANAGED_CREDENTIALS } from './pwb';
import { getAllModelDefinitions } from './modelDefinitions';
import { createModelInfo, getMaxTokens, markDefaultModel } from './modelResolutionHelpers.js';

/**
 * Models used by chat participants and for vscode.lm.* API functionality.
 */

export interface BedrockProviderVariables {
	AWS_REGION?: string;
	AWS_PROFILE?: string;
}

//#region Test Models
class ErrorLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Error Language Model';
	readonly provider = 'error';
	readonly id = 'error-language-model';
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;
	private readonly _message = '[ErrorLanguageModel] This language model always throws an error message.';

	constructor(
		_config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext,
		private readonly _storage?: SecretStorage,
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

	resolveModels(token: vscode.CancellationToken): Thenable<vscode.LanguageModelChatInformation[] | undefined> {
		throw new Error(this._message);
	}
}

class EchoLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Echo Language Model';
	readonly provider = 'echo';
	readonly id = 'echo-language-model';
	readonly maxInputTokens = DEFAULT_MAX_TOKEN_INPUT;
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;
	protected modelListing?: vscode.LanguageModelChatInformation[];

	constructor(
		private readonly _config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext,
		private readonly _storage?: SecretStorage,
	) { }

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
		log.debug(`[${this.providerName}] Preparing language model chat information...`);
		const models = this.modelListing ?? await this.resolveModels(token) ?? [];

		log.debug(`[${this.providerName}] Resolved ${models.length} models.`);
		return this.filterModels(models);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage[],
		options: { [name: string]: any },
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<any> {
		const _messages = toAIMessage(messages);
		const message = this.getUserPrompt(_messages);

		if (!message) {
			throw new Error(`[${this.providerName}] No user prompt provided to echo language model.`);
		}

		if (typeof message.content === 'string') {
			message.content = [{ type: 'text', text: message.content }];
		}

		if (message.content[0].type !== 'text') {
			throw new Error(`[${this.providerName}] Echo language model only supports text messages.`);
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
		else if (inputText === 'Return model') {
			response = model.id;
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

	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		return Promise.resolve(undefined);
	}

	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		const models = [{
			id: this.id,
			name: this.name,
			family: this.provider,
			version: '1.0.0',
			maxInputTokens: this.maxInputTokens,
			maxOutputTokens: this.maxOutputTokens,
			capabilities: this.capabilities,
			isDefault: true,
			isUserSelectable: true,
		}, {
			id: 'echo-language-model-v2',
			name: 'Echo Language Model v2',
			family: this.provider,
			version: '1.0.0',
			maxInputTokens: this.maxInputTokens,
			maxOutputTokens: this.maxOutputTokens,
			capabilities: this.capabilities,
			isUserSelectable: true,
		}];
		this.modelListing = models;
		return models;
	}

	filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		return applyModelFilters(models, this.provider, this.providerName);
	}

	private getUserPrompt(messages: ai.CoreMessage[]): ai.CoreMessage | undefined {
		if (messages.length === 0) {
			return undefined;
		}
		if (messages.length === 1) {
			return messages[0];
		}
		// If there are multiple messages, the last message is the user message.
		// See defaultRequestHandler in extensions/positron-assistant/src/participants.ts for the message ordering.
		const userPrompt = messages[messages.length - 1];
		if (userPrompt.role !== 'user') {
			return undefined;
		}
		return userPrompt;
	}
}

//#endregion
//#region Language Models

/**
 * Result of an autoconfiguration attempt.
 * - Signed in indicates whether the model is configured and ready to use.
 * - Message provides additional information to be displayed to user in the configuration modal, if signed in.
 */
export type AutoconfigureResult = {
	signedIn: false;
} | {
	signedIn: true;
	message: string;
};

abstract class AILanguageModel implements positron.ai.LanguageModelChatProvider {
	public static source: positron.ai.LanguageModelSource;

	public readonly name;
	public readonly provider;
	public readonly id;
	protected abstract aiProvider: (id: string, options?: Record<string, any>) => ai.LanguageModelV1;
	protected aiOptions: Record<string, any> = {};

	protected modelListing?: vscode.LanguageModelChatInformation[];

	capabilities = {
		vision: true,
		toolCalling: true,
		agentMode: true,
	};

	constructor(
		protected readonly _config: ModelConfig,
		protected readonly _context?: vscode.ExtensionContext,
		private readonly _storage?: SecretStorage,
	) {
		this.id = _config.id;
		this.name = _config.name;
		this.provider = _config.provider;
	}

	abstract get providerName(): string;

	protected filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		return applyModelFilters(models, this.provider, this.providerName);
	}

	async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		log.debug(`[${this.providerName}] Resolving connection...`);

		token.onCancellationRequested(() => {
			return false;
		});

		let models = await this.resolveModels(token);
		if (!models || models.length === 0) {
			return new Error(`[${this.providerName}] No models available for provider`);
		}

		models = this.filterModels(models);
		if (models.length === 0) {
			return new Error(`[${this.providerName}] No models available after applying filters`);
		}

		const maxModelsToTest = getMaxConnectionAttempts();
		const modelsToTest = models.slice(0, maxModelsToTest);

		log.debug(`[${this.providerName}] Testing up to ${modelsToTest.length} models for connectivity...`);

		const errors: string[] = [];

		// Try each model until one succeeds
		for (const modelInfo of modelsToTest) {
			if (token.isCancellationRequested) {
				return new Error(`[${this.providerName}] Connection test cancelled`);
			}

			const model = modelInfo.id;

			try {
				log.debug(`[${this.providerName}] '${model}' Sending test message...`);

				const result = await ai.generateText({
					model: this.aiProvider(model, this.aiOptions),
					prompt: `I'm checking to see if you're there. Respond only with the word "hello".`,
					abortSignal: AbortSignal.timeout(getProviderTimeoutMs()),
					maxRetries: 1, // Retry the request once in case of transient errors
				});

				log.debug(`[${this.providerName}] '${model}' Test message sent successfully.`);
				log.trace(`[${this.providerName}] '${model}' Test message response: ${result.text}`);
				return undefined; // Success! At least one model is working
			} catch (error) {
				const messagePrefix = `[${this.providerName}] '${model}'`;
				log.warn(`${messagePrefix} Error sending test message: ${JSON.stringify(error, null, 2)}`);
				const errorMsg = this.parseProviderError(error) ||
					(ai.AISDKError.isInstance(error) ? error.message : JSON.stringify(error, null, 2));
				errors.push(errorMsg);
			}
		}

		// If we get here, all tested models failed
		const allErrors = errors.join('; ');
		log.error(`[${this.providerName}] All ${modelsToTest.length} tested models failed: ${allErrors}`);
		return new Error(`[${this.providerName}] All tested models failed: ${allErrors}`);
	}

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		log.debug(`[${this.providerName}] Preparing language model chat information...`);
		const models = this.modelListing ?? await this.resolveModels(token) ?? [];
		return this.filterModels(models);
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
			aiModel.modelId.includes('anthropic');

		// Only select Bedrock models support cache breakpoints; specifically,
		// the Claude 3.5 Sonnet models don't support them.
		//
		// Consider: it'd be more verbose but we should consider including this information
		// in the hardcoded model metadata in the model config.
		const bedrockCacheBreakpoint = this.provider === 'amazon-bedrock' &&
			!aiModel.modelId.includes('anthropic.claude-3-5');

		// Add system prompt from `modelOptions.system`, if provided.
		// TODO: Once extensions such as databot no longer use `modelOptions.system`,
		// we can remove the `system` parameter and use the given system messages only.
		if (modelOptions.system) {
			processedMessages.unshift(new vscode.LanguageModelChatMessage(
				vscode.LanguageModelChatMessageRole.System,
				modelOptions.system
			));
		}

		// Convert all messages to the Vercel AI format.
		const aiMessages: ai.CoreMessage[] = toAIMessage(
			processedMessages,
			toolResultExperimentalContent,
			bedrockCacheBreakpoint
		);

		if (options.tools && options.tools.length > 0) {
			tools = options.tools.reduce((acc: Record<string, ai.Tool>, tool: vscode.LanguageModelChatTool) => {
				// Some providers like AWS Bedrock require a type for all tool input schemas; default to 'object' if not provided.
				// See similar handling for Anthropic in toAnthropicTool in extensions/positron-assistant/src/anthropic.ts
				const input_schema = tool.inputSchema as Record<string, any> ?? {
					type: 'object',
					properties: {},
				};
				if (!input_schema.type) {
					log.warn(`[${this.providerName}] Tool '${tool.name}' is missing input schema type; defaulting to 'object'`);
					input_schema.type = 'object';
				}
				acc[tool.name] = ai.tool({
					description: tool.description,
					parameters: ai.jsonSchema(input_schema),
				});
				return acc;
			}, {});
		}

		const modelTools = this._config.toolCalls ? tools : undefined;
		const requestId = (options.modelOptions as any)?.requestId;

		log.info(`[${this.providerName}] [vercel] Start request ${requestId} to ${model.name} [${aiModel.modelId}]: ${aiMessages.length} messages`);
		log.debug(`[${this.providerName}] [${model.name}] SEND ${aiMessages.length} messages, ${modelTools ? Object.keys(modelTools).length : 0} tools`);
		if (modelTools) {
			log.trace(`[${this.providerName}] tools: ${modelTools ? Object.keys(modelTools).join(', ') : '(none)'}`);
		}

		const systemMessage = aiMessages.find(m => m.role === 'system');
		if (systemMessage) {
			const content = systemMessage.content;
			log.trace(`[${this.providerName}] system: ${content.length > 100 ? `${content.substring(0, 100)}...` : content} (${content.length} chars)`);
		}

		log.trace(`[${this.providerName}] messages: ${JSON.stringify(aiMessages, null, 2)}`);
		const result = ai.streamText({
			model: aiModel,
			messages: aiMessages,
			maxSteps: modelOptions.maxSteps ?? 50,
			tools: modelTools,
			abortSignal: signal,
			maxTokens: getMaxTokens(aiModel.modelId, 'output', this._config.provider, this._config.maxOutputTokens, this.providerName),
		});

		let accumulatedTextDeltas: string[] = [];

		const flushAccumulatedTextDeltas = () => {
			if (accumulatedTextDeltas.length > 0) {
				const combinedText = accumulatedTextDeltas.join('');
				log.trace(`[${this.providerName}] [${model.name}] RECV text-delta (${accumulatedTextDeltas.length} parts): ${combinedText}`);
				accumulatedTextDeltas = [];
			}
		};

		for await (const part of result.fullStream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (part.type === 'reasoning') {
				flushAccumulatedTextDeltas();
				log.trace(`[${this.providerName}] [${this._config.name}] RECV reasoning: ${part.textDelta}`);
				progress.report(new vscode.LanguageModelTextPart(part.textDelta));
			}

			if (part.type === 'text-delta') {
				accumulatedTextDeltas.push(part.textDelta);
				progress.report(new vscode.LanguageModelTextPart(part.textDelta));
			}

			if (part.type === 'tool-call') {
				flushAccumulatedTextDeltas();
				log.trace(`[${this.providerName}] [${this._config.name}] RECV tool-call: ${part.toolCallId} (${part.toolName}) with args: ${JSON.stringify(part.args)}`);
				progress.report(new vscode.LanguageModelToolCallPart(part.toolCallId, part.toolName, part.args));
			}

			if (part.type === 'error') {
				flushAccumulatedTextDeltas();
				const messagePrefix = `[${this.providerName}] [${model.name}]'`;
				log.warn(`${messagePrefix} RECV error: ${JSON.stringify(part.error, null, 2)}`);
				const errorMsg = this.parseProviderError(part.error) ||
					(typeof part.error === 'string' ? part.error : JSON.stringify(part.error, null, 2));
				throw new Error(`${messagePrefix} Error in chat response: ${errorMsg}`);
			}
		}

		// Flush any remaining accumulated text deltas
		flushAccumulatedTextDeltas();

		// Log all the warnings from the response
		result.warnings.then((warnings) => {
			if (warnings) {
				for (const warning of warnings) {
					log.warn(`[${this.providerName}] [${aiModel.modelId}] warn: ${warning}`);
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
			log.debug(`[${this.providerName}] [${model.name}]: Bedrock usage: ${JSON.stringify(usage, null, 2)}`);
		}

		if (requestId) {
			recordRequestTokenUsage(requestId, this.provider, tokens);
		}

		if (this._context) {
			recordTokenUsage(this._context, this.provider, tokens);
		}

		log.info(`[${this.providerName}] [vercel]: End request ${requestId}; usage: ${tokens.inputTokens} input tokens (+${tokens.cachedTokens} cached), ${tokens.outputTokens} output tokens`);
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

	/**
	 * Resolves the available language models. Each provider will have their own way of fetching the model listing.
	 * @param token The cancellation token.
	 * @returns A promise that resolves to an array of language model descriptors or undefined if unsupported.
	 */
	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		log.debug(`[${this.providerName}] Resolving models...`);

		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		// Fallback to default model if no configured models available
		const defaultModel = this.createDefaultModel();
		this.modelListing = defaultModel;
		return defaultModel;
	}

	protected retrieveModelsFromConfig(): vscode.LanguageModelChatInformation[] | undefined {
		const configuredModels = getAllModelDefinitions(this.provider);
		if (configuredModels.length === 0) {
			return undefined;
		}

		log.info(`[${this.providerName}] Using ${configuredModels.length} configured models.`);

		const models: vscode.LanguageModelChatInformation[] = configuredModels.map(model =>
			createModelInfo({
				id: model.identifier,
				name: model.name,
				family: this.provider,
				version: this.aiProvider(model.identifier).specificationVersion,
				provider: this.provider,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: model.maxInputTokens ?? 0,
				defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
			})
		);

		return markDefaultModel(models, this.provider, this._config.model);
	}

	protected createDefaultModel(): vscode.LanguageModelChatInformation[] {
		log.info(`[${this.providerName}] No models available; returning default model information.`);
		const aiModel = this.aiProvider(this._config.model, this.aiOptions);
		const modelInfo = createModelInfo({
			id: aiModel.modelId,
			name: this.name,
			family: aiModel.provider,
			version: aiModel.specificationVersion,
			provider: this._config.provider,
			providerName: this.providerName,
			capabilities: this.capabilities,
			defaultMaxInput: this._config.maxInputTokens,
			defaultMaxOutput: this._config.maxOutputTokens
		});
		return [{ ...modelInfo, isDefault: true }];
	}

	/**
	 * Autoconfigures the language model, if supported.
	 * May implement functionality such as checking for environment variables or assessing managed credentials.
	 * @returns A promise that resolves to the autoconfigure result.
	 */
	static autoconfigure?: () => Promise<AutoconfigureResult>;
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
		supportedOptions: ['apiKey', 'autoconfigure'],
		defaults: {
			name: DEFAULT_ANTHROPIC_MODEL_NAME,
			model: DEFAULT_ANTHROPIC_MODEL_MATCH + '-latest',
			toolCalls: true,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.EnvVariable, key: 'ANTHROPIC_API_KEY', signedIn: false },
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

export class OpenAILanguageModel extends AILanguageModel implements positron.ai.LanguageModelChatProvider {
	protected aiProvider: OpenAIProvider;

	// Model name words to filter out (case-insensitive)
	// These models are typically not suitable for chat use cases,
	// i.e. they may not support the /chat/completions endpoint.
	public static readonly FILTERED_MODEL_PATTERNS = [
		'audio',
		'image',
		'moderation',
		'realtime',
		'search',
		'transcribe',
		'dall-e',
		'o3-pro',
	] as const;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'openai-api',
			displayName: 'OpenAI'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'OpenAI',
			model: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			toolCalls: true,
			completions: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.aiProvider = createOpenAI({
			apiKey: this._config.apiKey,
			baseURL: this.baseUrl,
		});
	}

	get providerName(): string {
		return OpenAILanguageModel.source.provider.displayName;
	}

	get baseUrl(): string | undefined {
		return (this._config.baseUrl ?? OpenAILanguageModel.source.defaults.baseUrl)?.replace(/\/+$/, '');
	}

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		log.debug(`[${this.providerName}] Preparing language model chat information...`);
		const models = await this.resolveModels(token) ?? [];

		log.debug(`[${this.providerName}] Resolved ${models.length} models.`);
		return this.filterModels(models);
	}

	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		log.debug(`[${this.providerName}] Resolving models...`);

		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		const apiModels = await this.retrieveModelsFromApi();
		if (apiModels) {
			this.modelListing = apiModels;
			return apiModels;
		}

		return undefined;
	}

	protected retrieveModelsFromConfig(): vscode.LanguageModelChatInformation[] | undefined {
		const configuredModels = getAllModelDefinitions(this.provider);
		if (configuredModels.length === 0) {
			return undefined;
		}

		log.info(`[${this.providerName}] Using ${configuredModels.length} configured models.`);

		const modelListing = configuredModels.map((modelDef) =>
			createModelInfo({
				id: modelDef.identifier,
				name: modelDef.name,
				family: this.provider,
				version: modelDef.identifier,
				provider: this.provider,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: modelDef.maxInputTokens ?? 0,
				defaultMaxOutput: modelDef.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
			})
		);

		return markDefaultModel(modelListing, this.provider, this._config.model);
	}

	private async retrieveModelsFromApi(): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		try {
			const data = await this.fetchModelsFromAPI();
			if (!data?.data || !Array.isArray(data.data)) {
				log.info(`[${this.providerName}] Request was successful, but no models were returned.`);
				return undefined;
			}
			log.info(`[${this.providerName}] Successfully fetched ${data.data.length} models.`);

			const models = data.data.map((model: any) =>
				createModelInfo({
					id: model.id,
					name: model.id,
					family: this.provider,
					version: model.id,
					provider: this.provider,
					providerName: this.providerName,
					capabilities: this.capabilities,
					defaultMaxInput: 0,
					defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
				})
			);

			return models;
		} catch (error) {
			log.warn(`[${this.providerName}] Failed to fetch models from API: ${error}`);
			return undefined;
		}
	}

	filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		const removedModels: string[] = [];
		const filteredModels = applyModelFilters(models, this.provider, this.providerName)
			.filter((model: any) => {
				const modelName = model.id.toLowerCase();
				const shouldRemove = OpenAILanguageModel.FILTERED_MODEL_PATTERNS.some(pattern => {
					const regex = new RegExp(`\\b${pattern.toLowerCase()}\\b`, 'i');
					return regex.test(modelName);
				});
				if (shouldRemove) {
					removedModels.push(model.id);
				}
				return !shouldRemove;
			});
		if (removedModels.length > 0) {
			log.debug(`[${this.providerName}] Removed ${removedModels.length} incompatible models: ${removedModels.join(', ')}`);
		}
		if (filteredModels.length === 0) {
			log.warn(`[${this.providerName}] No models remain after filtering.`);
		} else if (filteredModels.length === 1) {
			log.debug(`[${this.providerName}] 1 model remains after filtering: ${filteredModels[0].id}`);
		} else {
			log.debug(`[${this.providerName}] ${filteredModels.length} models remain after filtering: ${filteredModels.map(m => m.id).join(', ')}`);
		}
		return filteredModels;
	}

	private async fetchModelsFromAPI(): Promise<any> {
		const modelsUrl = `${this.baseUrl}/models`;
		log.info(`[${this.providerName}] Fetching models from ${modelsUrl}...`);

		const response = await fetch(modelsUrl, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this._config.apiKey}`,
				'Content-Type': 'application/json'
			}
		});

		const data = await response.json();

		if (!response.ok || data?.error) {
			log.error(`[${this.providerName}] Error fetching models: ${response.status} ${response.statusText} - ${JSON.stringify(data?.error.code)}`);
			const errorMsg = `Error fetching models: ${response.status} ${response.statusText} - ${data.error.code || JSON.stringify(data.error)}`;
			throw new Error(errorMsg);
		}

		return data;
	}
}

class OpenAICompatibleLanguageModel extends OpenAILanguageModel implements positron.ai.LanguageModelChatProvider {
	// This class is identical to OpenAILanguageModel but uses a different provider ID
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'openai-compatible',
			displayName: 'Custom Provider'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'Custom Provider',
			model: 'openai-compatible',
			baseUrl: 'https://localhost:1337/v1',
			toolCalls: true,
			completions: false,
		},
	};

	override get providerName(): string {
		return OpenAICompatibleLanguageModel.source.provider.displayName;
	}

	override get baseUrl(): string | undefined {
		return (this._config.baseUrl ?? OpenAICompatibleLanguageModel.source.defaults.baseUrl)?.replace(/\/+$/, '');
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
	static SUPPORTED_BEDROCK_PROVIDERS = ['Anthropic'];
	static LEGACY_MODELS_REGEX = [
		'.*anthropic\.claude-3-opus.*',
		'.*anthropic\.claude-3-5-sonnet.*',
	];
	static DEFAULT_MAX_TOKENS_INPUT = DEFAULT_MAX_TOKEN_INPUT;
	static DEFAULT_MAX_TOKENS_OUTPUT = 8192;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'amazon-bedrock',
			displayName: 'Amazon Bedrock'
		},
		supportedOptions: ['toolCalls', 'autoconfigure'],
		defaults: {
			name: 'Claude 4 Sonnet Bedrock',
			model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
			toolCalls: true,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.Custom, message: 'Automatically configured using AWS credentials', signedIn: false },
		},
	};
	bedrockClient: BedrockClient;
	inferenceProfiles: InferenceProfileSummary[] = [];

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);

		const environmentSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<BedrockProviderVariables>('bedrock', {});
		log.debug(`[BedrockLanguageModel] positron.assistant.providerVariables.bedrock settings: ${JSON.stringify(environmentSettings)}`);

		const { AWS_REGION, AWS_PROFILE }: BedrockProviderVariables = { ...process.env as BedrockProviderVariables, ...environmentSettings };
		const region = AWS_REGION ?? 'us-east-1';
		const profile = AWS_PROFILE ?? 'default';
		const credentials = fromNodeProviderChain({ profile });

		log.info(`[BedrockLanguageModel] Using AWS region: ${region} and profile: ${AWS_PROFILE ?? 'default'}`);

		// We use ai-sdk for generating text for chat
		this.aiProvider = createAmazonBedrock({
			// AWS_ACCESS_KEY_ID, AWS_SESSION_TOKEN, and AWS_SECRET_ACCESS_KEY must be set
			region, // sets the AWS region where the models are available
			credentialProvider: credentials
		});

		// We use the Bedrock SDK to retrieve the list of available models instead
		// of a predefined list.
		this.bedrockClient = new BedrockClient({
			region,
			credentials: credentials
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

		return vscode.l10n.t(`Amazon Bedrock error: {0}`, message);
	}

	override async resolveConnection(token: vscode.CancellationToken): Promise<Error | undefined> {
		// The Vercel and Bedrock SDKs both use the node provider chain for credentials so getting a listing
		// means the credentials are valid.
		log.debug(`[${this.providerName}] Resolving connection by fetching available models...`);
		await this.resolveModels(token);

		return undefined;
	}

	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		log.debug(`[${this.providerName}] Resolving models...`);

		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		const apiModels = await this.retrieveModelsFromApi();
		if (apiModels) {
			this.modelListing = apiModels;
			return apiModels;
		}

		return undefined;
	}

	protected retrieveModelsFromConfig(): vscode.LanguageModelChatInformation[] | undefined {
		const configuredModels = getAllModelDefinitions(this.provider);
		if (configuredModels.length === 0) {
			return undefined;
		}

		log.info(`[${this.providerName}] Using ${configuredModels.length} configured models.`);

		const modelListing = configuredModels.map((modelDef) =>
			createModelInfo({
				id: modelDef.identifier,
				name: modelDef.name,
				family: 'Amazon Bedrock',
				version: '',
				provider: this.provider,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: modelDef.maxInputTokens ?? AWSLanguageModel.DEFAULT_MAX_TOKENS_INPUT,
				defaultMaxOutput: modelDef.maxOutputTokens ?? AWSLanguageModel.DEFAULT_MAX_TOKENS_OUTPUT
			})
		);

		return modelListing;
	}

	private async retrieveModelsFromApi(): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		try {
			const command = new ListFoundationModelsCommand();

			log.info(`[${this.providerName}] Fetching available Amazon Bedrock models for these providers: ` + AWSLanguageModel.SUPPORTED_BEDROCK_PROVIDERS.join(', '));

			const response = await this.bedrockClient.send(command);
			const modelSummaries = response.modelSummaries;

			if (!modelSummaries || modelSummaries.length === 0) {
				log.error(`[${this.providerName}] No Amazon Bedrock models available`);
				return [];
			}
			log.info(`[${this.providerName}] Found ${modelSummaries.length} available models.`);

			log.debug(`[${this.providerName}] Fetching available Amazon Bedrock inference profiles...`);
			const inferenceResponse = await this.bedrockClient.send(new ListInferenceProfilesCommand());
			this.inferenceProfiles = inferenceResponse.inferenceProfileSummaries ?? [];

			if (this.inferenceProfiles.length === 0) {
				log.error(`[${this.providerName}] No Amazon Bedrock inference profiles available`);
				return [];
			}
			log.debug(`[${this.providerName}] Total inference profiles available: ${this.inferenceProfiles.length}`);

			// Filter for basic eligibility before creating model objects
			const filteredModelSummaries = this.filterModelSummaries(modelSummaries);
			log.debug(`[${this.providerName}] ${filteredModelSummaries.length} models available (from ${modelSummaries.length} total) after removing ineligible models.`);

			// Convert eligible model summaries to LanguageModelChatInformation objects
			const models = filteredModelSummaries.map(m => {
				const modelId = this.findInferenceProfileForModel(m.modelArn, this.inferenceProfiles);
				const modelInfo = createModelInfo({
					id: modelId,
					name: m.modelName ?? modelId,
					family: 'Amazon Bedrock',
					version: '',
					provider: this.provider,
					providerName: this.providerName,
					capabilities: this.capabilities,
					defaultMaxInput: AWSLanguageModel.DEFAULT_MAX_TOKENS_INPUT,
					defaultMaxOutput: AWSLanguageModel.DEFAULT_MAX_TOKENS_OUTPUT
				});
				return modelInfo;
			}).filter(m => {
				if (!m.id) {
					log.debug(`[${this.providerName}] Filtering out model without inference profile ARN: ${m.name}`);
					return false;
				}
				return true;
			});

			log.debug(`[${this.providerName}] Available models after processing: ${models.map(m => m.name).join(', ')}`);

			return models;
		} catch (error) {
			log.warn(`[${this.providerName}] Failed to fetch models from Bedrock API: ${error}`);
			return undefined;
		}
	}

	filterModels(models: vscode.LanguageModelChatInformation[]): vscode.LanguageModelChatInformation[] {
		return applyModelFilters(models, this.provider, this.providerName);
	}

	/**
	 * Filter model summaries for eligibility before converting to LanguageModelChatInformation.
	 * This handles all Bedrock-specific filtering at the source data level.
	 */
	private filterModelSummaries(modelSummaries: FoundationModelSummary[]): FoundationModelSummary[] {
		return modelSummaries.filter(m => {
			// Filter for ACTIVE models only
			if (m.modelLifecycle?.status !== 'ACTIVE') {
				log.debug(`[${this.providerName}] Filtering out non-ACTIVE model: ${m.modelName}`);
				return false;
			}

			// Filter for supported Bedrock providers
			if (!AWSLanguageModel.SUPPORTED_BEDROCK_PROVIDERS.includes(m.providerName as string)) {
				log.debug(`[${this.providerName}] Filtering out unsupported provider model: ${m.modelName} (provider: ${m.providerName})`);
				return false;
			}

			// Filter for models that support INFERENCE_PROFILE inference type
			// INFERENCE_PROFILE doesn't exist in the Bedrock types but it can actually return it so it casts the field to string[] to avoid typescript errors
			if (!m.inferenceTypesSupported || !(m.inferenceTypesSupported as string[]).includes('INFERENCE_PROFILE')) {
				log.debug(`[${this.providerName}] Filtering out model without INFERENCE_PROFILE support: ${m.modelName}`);
				return false;
			}

			// Filter out legacy models based on regex patterns using the original modelId
			if (AWSLanguageModel.LEGACY_MODELS_REGEX.some(regex => {
				const re = new RegExp(`${regex}`);
				return re.test(m.modelId);
			})) {
				log.debug(`[${this.providerName}] Filtering out legacy model: ${m.modelName} (modelId: ${m.modelId})`);
				return false;
			}

			// Filter out models without ARN
			if (!m.modelArn) {
				log.debug(`[${this.providerName}] Filtering out model without ARN: ${m.modelName}`);
				return false;
			}

			return true;
		});
	}

	/**
	 * Find the inference profile ARN for a specific model.
	 * This ensures that we can use the model and AWS will handle
	 * routing for regions and resource allocation.
	 *
	 * @param modelArn the model ARN to get the inference ARN
	 * @param inferenceProfiles profiles that the authenticated client can use
	 * @returns the inference profile ARN or undefined if not found
	 */
	private findInferenceProfileForModel(modelArn: string, inferenceProfiles: InferenceProfileSummary[]): string | undefined {
		for (const profile of inferenceProfiles) {
			const models = profile.models?.map(m => m.modelArn);
			if (models?.includes(modelArn)) {
				return profile.inferenceProfileArn;
			}
		}
		return undefined;
	}

	static override async autoconfigure(): Promise<AutoconfigureResult> {
		return autoconfigureWithManagedCredentials(
			AWS_MANAGED_CREDENTIALS,
			AWSLanguageModel.source.provider.id,
			AWSLanguageModel.source.provider.displayName
		);
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
		OpenAICompatibleLanguageModel,
		OpenRouterLanguageModel,
		PositLanguageModel,
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
export async function createAutomaticModelConfigs(): Promise<ModelConfig[]> {
	const models = getLanguageModels();
	const modelConfigs: ModelConfig[] = [];

	for (const model of models) {
		if (!('autoconfigure' in model.source.defaults)) {
			// Not an autoconfigurable model
			continue;
		}

		if (model.source.defaults.autoconfigure.type === positron.ai.LanguageModelAutoconfigureType.EnvVariable) {
			// Handle environment variable based auto-configuration
			const key = model.source.defaults.autoconfigure.key;
			// pragma: allowlist nextline secret
			const apiKey = key ? process.env[key] : undefined;

			if (key && apiKey) {
				const modelConfig: ModelConfig = {
					id: `${model.source.provider.id}`,
					provider: model.source.provider.id,
					type: positron.PositronLanguageModelType.Chat,
					name: model.source.provider.displayName,
					model: model.source.defaults.model,
					apiKey: apiKey,
					autoconfigure: {
						type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
						key: key,
						signedIn: true,
					}
				};
				modelConfigs.push(modelConfig);
			}
		} else if (model.source.defaults.autoconfigure.type === positron.ai.LanguageModelAutoconfigureType.Custom) {
			// Handle custom auto-configuration
			if ('autoconfigure' in model && model.autoconfigure) {
				const result = await model.autoconfigure();
				if (result.signedIn) {
					const modelConfig: ModelConfig = {
						id: `${model.source.provider.id}`,
						provider: model.source.provider.id,
						type: positron.PositronLanguageModelType.Chat,
						name: model.source.provider.displayName,
						model: model.source.defaults.model,
						apiKey: undefined,
						// pragma: allowlist nextline secret
						autoconfigure: {
							type: positron.ai.LanguageModelAutoconfigureType.Custom,
							message: result.message,
							signedIn: true
						}
					};
					modelConfigs.push(modelConfig);
				}
			}
		}
	}

	return modelConfigs;
}

// export function newLanguageModel(config: ModelConfig, context: vscode.ExtensionContext): positron.ai.LanguageModelChatProvider {
export function newLanguageModelChatProvider(config: ModelConfig, context: vscode.ExtensionContext, storage: SecretStorage): positron.ai.LanguageModelChatProvider {
	const providerClass = getLanguageModels().find((cls) => cls.source.provider.id === config.provider);
	if (!providerClass) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}
	return new providerClass(config, context, storage);
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

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext, _storage?: SecretStorage) {
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
