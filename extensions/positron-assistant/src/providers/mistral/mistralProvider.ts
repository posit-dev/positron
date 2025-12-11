/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createMistral, MistralProvider } from '@ai-sdk/mistral';
import { ModelProvider } from '../base/modelProvider';
import { ModelConfig } from '../../config';

/**
 * Mistral AI model provider implementation.
 * Supports Mistral's models via the Mistral API.
 */
export class MistralLanguageModel extends ModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: MistralProvider;

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
		this.initializeLogger();
		this.initializeProvider();
	}

	/**
	 * Initializes the Mistral provider.
	 */
	protected initializeProvider(): void {
		this.aiProvider = createMistral({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	/**
	 * Creates the AI provider instance.
	 * @returns The Mistral provider function.
	 */
	protected createAIProvider(): any {
		return this.aiProvider;
	}

	get providerName(): string {
		return MistralLanguageModel.source.provider.displayName;
	}
}