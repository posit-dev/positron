/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createVertex, GoogleVertexProvider } from '@ai-sdk/google-vertex';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { AIProviderFactory } from '../base/modelProviderTypes';
import { ModelConfig } from '../../config';

/**
 * Google Vertex AI model provider implementation.
 * Supports Google's Gemini models via Vertex AI.
 */
export class VertexLanguageModel extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: GoogleVertexProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'vertex',
			displayName: 'Google Vertex AI'
		},
		supportedOptions: ['toolCalls', 'project', 'location'],
		defaults: {
			name: 'Gemini 2.0 Flash',
			model: 'gemini-2.0-flash-exp',
			project: undefined,
			location: undefined,
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/**
	 * Initializes the Google Vertex AI provider.
	 */
	protected initializeProvider(): void {
		this.aiProvider = createVertex({
			project: this._config.project,
			location: this._config.location,
		});
	}

	/**
	 * Creates the AI provider instance.
	 * @returns The Vertex AI provider function.
	 */
	protected override createAIProvider(): AIProviderFactory {
		return this.aiProvider;
	}

	get providerName(): string {
		return VertexLanguageModel.source.provider.displayName;
	}
}