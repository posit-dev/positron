/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createAzure, AzureOpenAIProvider } from '@ai-sdk/azure';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../config';

/**
 * Azure OpenAI Service model provider implementation.
 *
 * This provider integrates with Azure OpenAI Service, which provides enterprise-grade
 * access to OpenAI models with:
 * - Azure's compliance and security features
 * - Regional deployment options
 * - Private endpoint support
 * - All GPT models (GPT-4o, GPT-4 Turbo, etc.)
 *
 * **Configuration:**
 * - Provider ID: `azure`
 * - Required: API key and resource name from Azure Portal
 * - Optional: Model selection, tool calling toggle
 * - Default Model: GPT-4o
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'azure-gpt4o',
 *   name: 'GPT 4o',
 *   provider: 'azure',
 *   apiKey: 'your-azure-key',
 *   resourceName: 'your-resource-name',
 *   model: 'gpt-4o'
 * };
 * const provider = new AzureModelProvider(config, context);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://azure.microsoft.com/en-us/products/ai-services/openai-service for Azure OpenAI documentation
 */
export class AzureModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * The Azure OpenAI provider instance from Vercel AI SDK.
	 */
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
	}

	/**
	 * Initializes the Azure OpenAI provider.
	 */
	protected override initializeProvider() {
		this.aiProvider = createAzure({
			apiKey: this._config.apiKey,
			resourceName: this._config.resourceName
		});
	}
}
