/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOllama } from 'ollama-ai-provider-v2';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../config';

/**
 * Ollama model provider implementation.
 *
 * This provider enables running open-source language models locally using Ollama.
 *
 * **Configuration:**
 * - Provider ID: `ollama`
 * - Required: Ollama running locally (default: http://localhost:11434)
 * - Optional: Base URL for remote Ollama instances, context window size
 * - No API key required (local deployment)
 *
 * **Features:**
 * - Fully local execution (privacy-focused)
 * - Customizable context window via `numCtx`
 * - Support for various open-source models
 * - Optional tool calling (model-dependent)
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'qwen-coder',
 *   name: 'Qwen 2.5 Coder',
 *   provider: 'ollama',
 *   model: 'qwen2.5-coder:7b',
 *   baseUrl: 'http://localhost:11434/api',
 *   numCtx: 4096
 * };
 * const provider = new OllamaModelProvider(config, context);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://ollama.com/ for Ollama documentation
 */
export class OllamaModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'ollama',
			displayName: 'Ollama'
		},
		supportedOptions: ['baseUrl', 'toolCalls', 'numCtx'],
		defaults: {
			name: 'Qwen 2.5',
			model: 'qwen2.5-coder:7b',
			baseUrl: 'http://localhost:11434/api',
			toolCalls: false,
			numCtx: 2048,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/**
	 * Initializes the Ollama provider.
	 */
	protected override initializeProvider() {
		this.aiOptions = {
			numCtx: this._config.numCtx,
		};
		this.aiProvider = createOllama({ baseURL: this._config.baseUrl });
	}
}
