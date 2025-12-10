/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOllama, OllamaProvider } from 'ollama-ai-provider';
import { ModelProvider } from '../base/modelProvider';
import { ModelConfig } from '../../config';

/**
 * Ollama model provider implementation.
 * Ollama allows running open-source LLMs locally.
 */
export class OllamaLanguageModel extends ModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: OllamaProvider;

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
		this.aiOptions = {
			numCtx: this._config.numCtx,
		};
		this.initializeProvider();
	}

	/**
	 * Initializes the Ollama provider.
	 */
	protected initializeProvider(): void {
		this.aiProvider = createOllama({ baseURL: this._config.baseUrl });
	}

	/**
	 * Creates the AI provider instance.
	 * @returns The Ollama provider function.
	 */
	protected createAIProvider(): any {
		return this.aiProvider;
	}

	get providerName(): string {
		return OllamaLanguageModel.source.provider.displayName;
	}
}