/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropic, AnthropicProvider } from '@ai-sdk/anthropic';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../configTypes.js';
import { getProviderTimeoutMs } from '../../providerConfig.js';
import {
	DEFAULT_DEEPSEEK_MODEL_NAME,
	DEFAULT_DEEPSEEK_MODEL_MATCH,
	fetchDeepseekModelsFromApi,
	getDeepseekModelsFromConfig
} from './deepseekModelUtils.js';
import { handleVercelSdkRateLimitError } from '../anthropic/anthropicModelUtils.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';

/**
 * Deepseek model provider implementation.
 *
 * This provider integrates Deepseek's models (e.g., DeepSeek-V4-Flash,
 * DeepSeek-V4-Pro) using the Vercel AI SDK's Anthropic adapter. It supports:
 * - All Claude model variants
 * - Vision capabilities (image inputs)
 * - Tool/function calling
 * - Streaming responses
 * - Prompt caching for reduced costs
 *
 * **Configuration:**
 * - Provider ID: `deepseek-api`
 * - Required: API key from Deepseek
 * - Optional: Model selection, tool calling toggle
 * - Supports: Environment variable autoconfiguration (ANTHROPIC_API_KEY)
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'deepseek-v4-pro',
 *   name: 'DeepSeek-V4-Pro',
 *   provider: 'deepseek',
 *   apiKey: 'sk-ant-...',
 *   model: 'deepseek-v4-pro',
 *   toolCalls: true
 * };  * const provider = new DeepseekAIModelProvider(config, context);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://api-docs.deepseek.com/ for Anthropic API documentation
 */
export class AnthropicAIModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * The Anthropic provider instance from Vercel AI SDK.
	 */
	protected declare aiProvider: AnthropicProvider;

	/**
	 * Native Anthropic client for API operations like model listing.
	 * The Vercel AI SDK doesn't expose model listing, so we use the native client.
	 */
	private readonly _client: Anthropic;

	/**
	 * Static configuration source describing this provider's requirements and defaults.
	 */
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.anthropic,
		supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
		defaults: {
			name: DEFAULT_ANTHROPIC_MODEL_NAME,
			model: DEFAULT_ANTHROPIC_MODEL_MATCH + '-latest',
			baseUrl: 'https://api.anthropic.com',
			toolCalls: true,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.EnvVariable, key: 'ANTHROPIC_API_KEY', signedIn: false },
		},
	};

	get baseUrl(): string | undefined {
		return (this._config.baseUrl
			?? AnthropicAIModelProvider.source.defaults.baseUrl)
			?.replace(/\/v1\/?$/, '')
			.replace(/\/+$/, '');
	}

	/**
	 * Creates a new Anthropic provider instance.
	 *
	 * @param _config - Configuration including API key and model selection
	 * @param _context - VS Code extension context for storage and features
	 */
	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		// Initialize native client for API operations like model listing
		this._client = new Anthropic({
			apiKey: _config.apiKey,
			baseURL: this.baseUrl,
		});
	}

	protected override async validateCredentials() {
		if (!this._config.apiKey?.trim()) {
			return false;
		}
		// Custom endpoints may use non-standard key formats
		if (this._config.baseUrl) {
			return true;
		}
		return this._config.apiKey.startsWith('sk-ant-');
	}

	override async resolveConnection(token: vscode.CancellationToken) {
		const timeoutMs = getProviderTimeoutMs();
		try {
			await this._client.withOptions({ timeout: timeoutMs }).models.list();
		} catch (error) {
			// Custom endpoints may not expose /v1/models; treat 404 as connected
			if (this._config.baseUrl && error instanceof Anthropic.APIError && error.status === 404) {
				return;
			}
			return error as Error;
		}
	}

	/**
	 * Initializes the Anthropic provider using the Vercel AI SDK.
	 *
	 * Creates an Anthropic provider instance with the configured API key.
	 * This is called automatically during construction.
	 */
	protected override initializeProvider() {
		// Vercel SDK expects baseURL to include /v1
		// (default is https://api.anthropic.com/v1)
		this.aiProvider = createAnthropic({
			apiKey: this._config.apiKey,
			baseURL: `${this.baseUrl}/v1`,
		});
	}

	/**
	 * Retrieves models from user configuration for Anthropic providers.
	 */
	protected override retrieveModelsFromConfig() {
		return getAnthropicModelsFromConfig(
			this.providerId,
			this.providerName,
			this.capabilities,
			this.logger
		);
	}

	/**
	 * Fetches models from the Anthropic API with pagination support.
	 */
	protected override async retrieveModelsFromApi(_token: vscode.CancellationToken) {
		return fetchAnthropicModelsFromApi(
			this._client,
			this.providerId,
			this.providerName,
			this.capabilities,
			this.logger
		);
	}

	override async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		const aiModel = this.aiProvider(model.id);

		// Only Anthropic currently supports experimental_content in tool results
		const toolResultExperimentalContent = this.providerId === 'anthropic-api' ||
			aiModel.modelId.includes('anthropic');

		// Provide the response using the base class implementation
		return super.provideVercelResponse(
			model,
			messages,
			options,
			progress,
			token,
			{ toolResultExperimentalContent, anthropicCacheBreakpoint: true }
		);
	}

	/**
	 * Handles Anthropic-specific errors during stream processing.
	 *
	 * Checks for rate limit errors (429) and extracts the retry-after header
	 * to provide a more helpful error message to the user.
	 *
	 * @param error - The error that occurred during streaming
	 * @throws A transformed error with retry information if rate limited
	 */
	protected override handleStreamError(error: unknown): never {
		// Check for rate limit error with retry-after header
		handleVercelSdkRateLimitError(error, this.providerName);
		throw error;
	}
}
