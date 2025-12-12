/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { AIProviderFactory } from '../base/modelProviderTypes';
import { ModelConfig, SecretStorage } from '../../config';

/**
 * Google Gemini model provider implementation.
 *
 * This provider integrates Google's Gemini models using the Vercel AI SDK's
 * Google Generative AI adapter. Supports:
 * - Gemini 2.0 Flash (latest)
 * - Gemini 1.5 Pro
 * - Gemini 1.5 Flash
 * - Vision capabilities
 * - Tool/function calling
 * - Streaming responses
 *
 * **Configuration:**
 * - Provider ID: `google`
 * - Display Name: `Gemini Code Assist`
 * - Required: API key from Google AI Studio
 * - Optional: Custom base URL, model selection
 * - Supports: Tool calling and completions
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'gemini-2-flash',
 *   name: 'Gemini 2.0 Flash',
 *   provider: 'google',
 *   apiKey: 'your-api-key',
 *   model: 'gemini-2.0-flash-exp',
 *   baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
 * };
 * const provider = new GoogleLanguageModel(config, context, storage);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://ai.google.dev/ for Google Generative AI documentation
 */
export class GoogleLanguageModel extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * The Google Generative AI provider instance from Vercel AI SDK.
	 */
	protected declare aiProvider: GoogleGenerativeAIProvider;

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
		super(_config, _context, _storage);
	}

	/**
	 * Initializes the Google Generative AI provider.
	 */
	protected initializeProvider(): void {
		this.aiProvider = createGoogleGenerativeAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	/**
	 * Creates the AI provider instance.
	 * @returns The Google Generative AI provider function.
	 */
	protected override createAIProvider(): AIProviderFactory {
		return this.aiProvider;
	}

	get providerName(): string {
		return GoogleLanguageModel.source.provider.displayName;
	}
}