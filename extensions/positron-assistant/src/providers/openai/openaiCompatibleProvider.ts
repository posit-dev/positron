/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { OpenAIModelProvider } from './openaiProvider';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils';
import { PROVIDER_METADATA } from '../../providerMetadata.js';

/**
 * OpenAI-compatible model provider implementation.
 *
 * This provider supports any service that implements the OpenAI API specification,
 * enabling integration with:
 * - Local LLM servers (LM Studio, LocalAI, vLLM, etc.)
 * - Custom model deployments
 * - Alternative AI providers with OpenAI-compatible APIs
 * - Self-hosted inference servers
 *
 * This class extends {@link OpenAIModelProvider} and inherits all its functionality,
 * only changing the provider ID and display name to differentiate it from the
 * official OpenAI provider.
 *
 * **Configuration:**
 * - Provider ID: `openai-compatible`
 * - Display Name: `Custom Provider`
 * - Required: Base URL pointing to your OpenAI-compatible endpoint
 * - Optional: API key (if required by your endpoint)
 *
 * @example
 * ```typescript
 * // LM Studio local server
 * const config: ModelConfig = {
 *   id: 'local-llm',
 *   name: 'Local LLM',
 *   provider: 'openai-compatible',
 *   baseUrl: 'http://localhost:1234/v1',
 *   model: 'local-model'
 * };
 * const provider = new OpenAICompatibleModelProvider(config, context);
 * ```
 *
 * @see {@link OpenAIModelProvider} for inherited functionality
 * @see {@link ModelProvider} for base class documentation
 */
export class OpenAICompatibleModelProvider extends OpenAIModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * OpenAI-compatible providers use /v1/chat/completions endpoint
	 */
	protected override usesChatCompletions = true;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.customProvider,
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'Custom Provider',
			model: 'openai-compatible',
			baseUrl: 'https://localhost:1337/v1',
			toolCalls: true
		},
	};

	/**
	 * Gets the base URL for the OpenAI-compatible API.
	 *
	 * Overrides the parent implementation to use the custom provider's defaults
	 * instead of OpenAI's defaults.
	 *
	 * @returns The base URL for API requests
	 */
	override get baseUrl() {
		return (this._config.baseUrl ?? OpenAICompatibleModelProvider.source.defaults.baseUrl)?.replace(/\/+$/, '');
	}

	/**
	 * Initializes the OpenAI-compatible provider with chat wrapper.
	 *
	 * Creates an OpenAI provider that uses the `/v1/chat/completions` endpoint
	 * instead of the newer `/v1/responses` endpoint. This ensures compatibility
	 * with providers like Snowflake, OpenRouter, and custom OpenAI-compatible
	 * deployments that only support the older chat completions API.
	 *
	 * The wrapper routes all model calls to the `.chat()` method, which forces
	 * the use of the `/v1/chat/completions` endpoint.
	 */
	protected override initializeProvider() {
		const baseProvider = createOpenAI({
			apiKey: this._config.apiKey,
			baseURL: this.baseUrl,
			fetch: createOpenAICompatibleFetch(this.providerName)
		});

		// Create a callable wrapper that routes to .chat() for the default call
		// This ensures OpenAI-compatible providers use v1/chat/completions instead of v1/responses
		const chatWrapper = ((modelId: string) => baseProvider.chat(modelId)) as OpenAIProvider;

		// Copy over any additional properties/methods from the base provider
		Object.assign(chatWrapper, baseProvider);

		// Override the callable to always use chat
		this.aiProvider = chatWrapper;
	}
}
