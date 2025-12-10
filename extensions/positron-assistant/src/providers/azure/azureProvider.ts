/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createAzure, AzureOpenAIProvider } from '@ai-sdk/azure';
import { ModelProvider } from '../base/modelProvider';
import { ModelConfig } from '../../config';

/**
 * Azure OpenAI model provider implementation.
 * Supports Azure OpenAI Service models.
 */
export class AzureLanguageModel extends ModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: AzureOpenAIProvider;

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
		this.initializeProvider();
	}

	/**
	 * Initializes the Azure OpenAI provider.
	 */
	protected initializeProvider(): void {
		this.aiProvider = createAzure({
			apiKey: this._config.apiKey,
			resourceName: this._config.resourceName
		});
	}

	/**
	 * Creates the AI provider instance.
	 * @returns The Azure OpenAI provider function.
	 */
	protected createAIProvider(): any {
		return this.aiProvider;
	}

	get providerName(): string {
		return AzureLanguageModel.source.provider.displayName;
	}
}