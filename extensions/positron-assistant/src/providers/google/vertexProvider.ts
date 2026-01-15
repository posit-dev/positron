/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createVertex, GoogleVertexProvider } from '@ai-sdk/google-vertex';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../config';

/**
 * Google Vertex AI model provider implementation.
 * Supports Google's Gemini models via Vertex AI.
 */
export class VertexModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: GoogleVertexProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'vertex',
			displayName: 'Google Vertex AI',
			settingName: 'vertex'
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
	protected override initializeProvider() {
		this.aiProvider = createVertex({
			project: this._config.project,
			location: this._config.location,
		});
	}
}
