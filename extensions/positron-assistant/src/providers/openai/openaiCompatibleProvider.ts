/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { OpenAILanguageModel } from './openaiProvider';

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
 * This class extends {@link OpenAILanguageModel} and inherits all its functionality,
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
 * const provider = new OpenAICompatibleLanguageModel(config, context);
 * ```
 *
 * @see {@link OpenAILanguageModel} for inherited functionality
 * @see {@link ModelProvider} for base class documentation
 */
export class OpenAICompatibleLanguageModel extends OpenAILanguageModel implements positron.ai.LanguageModelChatProvider {
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

	/**
	 * Gets the display name for this provider.
	 *
	 * @returns The string 'Custom Provider'
	 */
	get providerName(): string {
		return OpenAICompatibleLanguageModel.source.provider.displayName;
	}

	/**
	 * Gets the base URL for the OpenAI-compatible API.
	 *
	 * Overrides the parent implementation to use the custom provider's defaults
	 * instead of OpenAI's defaults.
	 *
	 * @returns The base URL for API requests
	 */
	get baseUrl(): string | undefined {
		return (this._config.baseUrl ?? OpenAICompatibleLanguageModel.source.defaults.baseUrl)?.replace(/\/+$/, '');
	}
}