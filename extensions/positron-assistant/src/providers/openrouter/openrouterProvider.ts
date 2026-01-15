/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOpenRouter, OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../config';

/**
 * OpenRouter model provider implementation.
 * OpenRouter provides access to multiple AI models through a single API.
 */
export class OpenRouterModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: OpenRouterProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'openrouter',
			displayName: 'OpenRouter',
			settingName: 'openrouter'
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
	}

	/**
	 * Initializes the OpenRouter provider.
	 */
	protected override initializeProvider() {
		this.aiProvider = createOpenRouter({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}
}
