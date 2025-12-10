/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { OpenAILanguageModel } from './openaiProvider';

/**
 * OpenAI-compatible model provider implementation.
 * Supports providers that implement the OpenAI API specification.
 *
 * This class extends OpenAILanguageModel and overrides the provider ID
 * to differentiate it from the official OpenAI provider.
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

	get providerName(): string {
		return OpenAICompatibleLanguageModel.source.provider.displayName;
	}

	/**
	 * Gets the base URL for the OpenAI-compatible API.
	 * Overrides the parent implementation to use the custom provider's defaults.
	 */
	get baseUrl(): string | undefined {
		return (this._config.baseUrl ?? OpenAICompatibleLanguageModel.source.defaults.baseUrl)?.replace(/\/+$/, '');
	}
}