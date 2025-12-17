/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ai from 'ai';
import * as vscode from 'vscode';
import {
	LLMRequestOptions,
	UnifiedStreamResult,
	UnifiedGenerateResult,
	ModelInfo,
	ProviderInfo,
	PositronLLMApi,
} from './llm-api.js';
import { getLanguageModels } from './models.js';
import { ModelConfig, SecretStorage } from './config.js';
import {
	toVSCodeMessages,
	toVSCodeTools,
	wrapVSCodeStreamAsUnified,
} from './copilot-adapter.js';
import { log } from './extension.js';

/**
 * Implementation of the unified LLM API for Positron extensions.
 */
export class PositronLLMApiImpl implements PositronLLMApi {
	private _onModelsChanged = new vscode.EventEmitter<void>();
	public readonly onModelsChanged = this._onModelsChanged.event;

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _storage: SecretStorage,
		private readonly _getRegisteredConfigs: () => ModelConfig[],
	) {
		// Wire up vscode.lm model changes (for Copilot)
		vscode.lm.onDidChangeChatModels(() => {
			this._onModelsChanged.fire();
		});
	}

	/**
	 * Called by extension.ts when Positron model configs change.
	 */
	notifyConfigsChanged(): void {
		this._onModelsChanged.fire();
	}

	// -----------------------------------------------------------------
	// Text Generation
	// -----------------------------------------------------------------

	async streamText(options: LLMRequestOptions): Promise<UnifiedStreamResult> {
		const resolved = await this.resolveModel(options.model);

		if (resolved.isCopilot) {
			return this.streamViaCopilot(resolved.copilotModel!, options);
		} else {
			return this.streamViaAISdk(resolved.config!, options);
		}
	}

	async generateText(options: LLMRequestOptions): Promise<UnifiedGenerateResult> {
		const resolved = await this.resolveModel(options.model);

		if (resolved.isCopilot) {
			return this.generateViaCopilot(resolved.copilotModel!, options);
		} else {
			return this.generateViaAISdk(resolved.config!, options);
		}
	}

	// -----------------------------------------------------------------
	// AI SDK Path (non-Copilot)
	// -----------------------------------------------------------------

	private async streamViaAISdk(
		config: ModelConfig,
		options: LLMRequestOptions
	): Promise<UnifiedStreamResult> {
		const aiModel = await this.createAIModel(config);

		log.debug(`[LLM API] Streaming via AI SDK: ${config.provider}/${config.model}`);

		const result = ai.streamText({
			model: aiModel,
			messages: options.messages,
			tools: options.tools,
			maxOutputTokens: options.maxTokens,
			temperature: options.temperature,
			abortSignal: options.abortSignal,
			stopWhen: options.maxSteps ? ai.stepCountIs(options.maxSteps) : undefined,
		});

		// Wrap the AI SDK result to match our unified interface
		return this.wrapAISdkStreamResult(result);
	}

	/**
	 * Wraps an AI SDK stream result to match our UnifiedStreamResult interface.
	 */
	private wrapAISdkStreamResult(result: ReturnType<typeof ai.streamText>): UnifiedStreamResult {
		return {
			textStream: result.textStream,
			fullStream: this.adaptFullStream(result.fullStream),
			text: result.text,
			toolCalls: result.toolCalls.then(calls => calls.map(c => ({
				toolCallId: c.toolCallId,
				toolName: c.toolName,
				args: (c as any).args ?? (c as any).input,
			}))),
			usage: result.usage.then(u => ({
				inputTokens: u?.inputTokens ?? 0,
				outputTokens: u?.outputTokens ?? 0,
			})),
		};
	}

	/**
	 * Adapts the AI SDK full stream to our unified stream part format.
	 */
	private async *adaptFullStream(
		stream: AsyncIterable<any>
	): AsyncIterable<import('./llm-api.js').UnifiedStreamPart> {
		for await (const part of stream) {
			if (part.type === 'text-delta') {
				yield { type: 'text-delta', textDelta: part.textDelta ?? part.text ?? '' };
			} else if (part.type === 'tool-call') {
				yield {
					type: 'tool-call',
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					args: part.args ?? part.input,
				};
			} else if (part.type === 'tool-result') {
				yield {
					type: 'tool-result',
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					result: part.result ?? part.output,
				};
			} else if (part.type === 'step-finish') {
				yield {
					type: 'step-finish',
					finishReason: this.normalizeFinishReason(part.finishReason),
					usage: {
						inputTokens: part.usage?.inputTokens ?? 0,
						outputTokens: part.usage?.outputTokens ?? 0,
					},
				};
			} else if (part.type === 'finish') {
				yield {
					type: 'finish',
					finishReason: this.normalizeFinishReason(part.finishReason),
					usage: {
						inputTokens: part.usage?.inputTokens ?? 0,
						outputTokens: part.usage?.outputTokens ?? 0,
					},
				};
			} else if (part.type === 'error') {
				yield { type: 'error', error: part.error };
			}
			// Ignore other part types like 'text-start', 'reasoning-delta', etc.
		}
	}

	/**
	 * Normalizes AI SDK finish reasons to our unified type.
	 */
	private normalizeFinishReason(reason: string | undefined): import('./llm-api.js').FinishReason {
		switch (reason) {
			case 'stop': return 'stop';
			case 'length': return 'length';
			case 'tool-calls': return 'tool-calls';
			case 'content-filter': return 'content-filter';
			case 'error': return 'error';
			default: return 'unknown';
		}
	}

	private async generateViaAISdk(
		config: ModelConfig,
		options: LLMRequestOptions
	): Promise<UnifiedGenerateResult> {
		const aiModel = await this.createAIModel(config);

		log.debug(`[LLM API] Generating via AI SDK: ${config.provider}/${config.model}`);

		const result = await ai.generateText({
			model: aiModel,
			messages: options.messages,
			tools: options.tools,
			maxOutputTokens: options.maxTokens,
			temperature: options.temperature,
			abortSignal: options.abortSignal,
			stopWhen: options.maxSteps ? ai.stepCountIs(options.maxSteps) : undefined,
		});

		return {
			text: result.text,
			toolCalls: (result.toolCalls ?? []).map(c => ({
				toolCallId: c.toolCallId,
				toolName: c.toolName,
				args: (c as any).args ?? (c as any).input,
			})),
			usage: {
				inputTokens: result.usage?.inputTokens ?? 0,
				outputTokens: result.usage?.outputTokens ?? 0,
			},
			finishReason: this.normalizeFinishReason(result.finishReason),
		};
	}

	private async createAIModel(config: ModelConfig): Promise<ai.LanguageModel> {
		const providerClasses = getLanguageModels();
		const ProviderClass = providerClasses.find(
			p => p.source.provider.id === config.provider
		);

		if (!ProviderClass) {
			throw new Error(`Provider not found: ${config.provider}`);
		}

		const instance = new ProviderClass(config, this._context, this._storage) as any;

		// The provider classes expose an aiProvider property that is an AI SDK provider
		// We need to call it with the model ID to get the language model
		if ('aiProvider' in instance) {
			const provider = instance.aiProvider;
			if (typeof provider === 'function') {
				return provider(config.model);
			} else if (provider && typeof provider.chat === 'function') {
				// Some providers like OpenAI wrap the chat method
				return provider.chat(config.model);
			} else if (provider && typeof provider === 'object') {
				// Try calling the provider directly as a function-like object
				return provider(config.model);
			}
		}

		throw new Error(`Provider ${config.provider} does not expose an AI SDK model`);
	}

	// -----------------------------------------------------------------
	// Copilot Path
	// -----------------------------------------------------------------

	private async streamViaCopilot(
		model: vscode.LanguageModelChat,
		options: LLMRequestOptions
	): Promise<UnifiedStreamResult> {
		const messages = toVSCodeMessages(options.messages);
		const tools = options.tools ? toVSCodeTools(options.tools) : undefined;

		const tokenSource = new vscode.CancellationTokenSource();
		if (options.abortSignal) {
			options.abortSignal.addEventListener(
				'abort',
				() => tokenSource.cancel(),
				{ once: true }  // Prevent memory leak
			);
		}

		log.debug(`[LLM API] Streaming via Copilot: ${model.id}`);

		const response = await model.sendRequest(
			messages,
			{ tools },
			tokenSource.token
		);

		// Adapt vscode.lm response to our unified format (true streaming)
		return wrapVSCodeStreamAsUnified(response);
	}

	private async generateViaCopilot(
		model: vscode.LanguageModelChat,
		options: LLMRequestOptions
	): Promise<UnifiedGenerateResult> {
		const stream = await this.streamViaCopilot(model, options);

		log.debug(`[LLM API] Generating via Copilot: ${model.id}`);

		// Consume the stream to get final results
		const [text, toolCalls, usage] = await Promise.all([
			stream.text,
			stream.toolCalls,
			stream.usage,
		]);

		return {
			text,
			toolCalls,
			usage,
			finishReason: 'stop',  // vscode.lm doesn't expose finish reason
		};
	}

	// -----------------------------------------------------------------
	// Model Resolution
	// -----------------------------------------------------------------

	private async resolveModel(modelId?: string): Promise<{
		isCopilot: boolean;
		copilotModel?: vscode.LanguageModelChat;
		config?: ModelConfig;
	}> {
		const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		const configs = this._getRegisteredConfigs();

		if (modelId) {
			// Parse canonical format: "provider/model"
			if (modelId.includes('/')) {
				const [provider, rawModelId] = modelId.split('/', 2);

				if (provider === 'copilot') {
					const copilotModel = copilotModels.find(m => m.id === rawModelId);
					if (copilotModel) {
						return { isCopilot: true, copilotModel };
					}
					throw new Error(`Copilot model not found: ${rawModelId}`);
				}

				const config = configs.find(
					c => c.provider === provider && c.model === rawModelId
				);
				if (config) {
					return { isCopilot: false, config };
				}
				throw new Error(`Model not found: ${modelId}`);
			}

			// Raw model ID - search all sources
			// Check Copilot first
			const copilotModel = copilotModels.find(m => m.id === modelId);
			if (copilotModel) {
				return { isCopilot: true, copilotModel };
			}

			// Check Positron configs
			const config = configs.find(c => c.model === modelId);
			if (config) {
				return { isCopilot: false, config };
			}

			throw new Error(`Model not found: ${modelId}`);
		}

		// Default: prefer first Positron config, fall back to Copilot
		if (configs.length > 0) {
			return { isCopilot: false, config: configs[0] };
		}

		if (copilotModels.length > 0) {
			return { isCopilot: true, copilotModel: copilotModels[0] };
		}

		throw new Error(
			'No language models available. Configure a model in Positron Assistant settings.'
		);
	}

	// -----------------------------------------------------------------
	// Discovery
	// -----------------------------------------------------------------

	async getAvailableModels(): Promise<ModelInfo[]> {
		const models: ModelInfo[] = [];

		// Add Positron-registered models with canonical IDs
		const configs = this._getRegisteredConfigs();
		for (const config of configs) {
			const providerClass = getLanguageModels().find(
				p => p.source.provider.id === config.provider
			);
			models.push({
				id: `${config.provider}/${config.model}`,  // Canonical format
				name: config.name,
				provider: config.provider,
				providerDisplayName: providerClass?.source.provider.displayName ?? config.provider,
				isCopilot: false,
				maxInputTokens: config.maxInputTokens,
				maxOutputTokens: config.maxOutputTokens,
			});
		}

		// Add Copilot models with canonical IDs
		const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		for (const model of copilotModels) {
			models.push({
				id: `copilot/${model.id}`,  // Canonical format
				name: model.name,
				provider: 'copilot',
				providerDisplayName: 'GitHub Copilot',
				isCopilot: true,
				maxInputTokens: model.maxInputTokens,
				maxOutputTokens: undefined,
			});
		}

		return models;
	}

	async getAvailableProviders(): Promise<ProviderInfo[]> {
		const providers: ProviderInfo[] = [];
		const configs = this._getRegisteredConfigs();

		// Group configs by provider
		const configsByProvider = new Map<string, ModelConfig[]>();
		for (const config of configs) {
			const existing = configsByProvider.get(config.provider) ?? [];
			existing.push(config);
			configsByProvider.set(config.provider, existing);
		}

		// Add Positron providers
		for (const [providerId, providerConfigs] of configsByProvider) {
			const providerClass = getLanguageModels().find(
				p => p.source.provider.id === providerId
			);
			providers.push({
				id: providerId,
				displayName: providerClass?.source.provider.displayName ?? providerId,
				isConfigured: true,
				modelCount: providerConfigs.length,
			});
		}

		// Add Copilot if available
		const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		if (copilotModels.length > 0) {
			providers.push({
				id: 'copilot',
				displayName: 'GitHub Copilot',
				isConfigured: true,
				modelCount: copilotModels.length,
			});
		}

		return providers;
	}
}
