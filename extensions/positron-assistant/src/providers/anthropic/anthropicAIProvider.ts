/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createAnthropic, AnthropicProvider } from '@ai-sdk/anthropic';
import { ModelProvider } from '../base/modelProvider';
import { ModelConfig } from '../../config';
import { DEFAULT_ANTHROPIC_MODEL_NAME, DEFAULT_ANTHROPIC_MODEL_MATCH } from '../../anthropic';

/**
 * Anthropic model provider implementation using Vercel AI SDK.
 * This provider uses the Vercel AI SDK's Anthropic integration for Claude models.
 *
 * Note: The 'anthropic' provider name is taken by Copilot Chat,
 * so we use 'anthropic-api' instead.
 */
export class AnthropicAILanguageModel extends ModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: AnthropicProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			// Note: The 'anthropic' provider name is taken by Copilot Chat; we
			// use 'anthropic-api' instead to make it possible to differentiate
			// the two.
			id: 'anthropic-api',
			displayName: 'Anthropic'
		},
		supportedOptions: ['apiKey', 'autoconfigure'],
		defaults: {
			name: DEFAULT_ANTHROPIC_MODEL_NAME,
			model: DEFAULT_ANTHROPIC_MODEL_MATCH + '-latest',
			toolCalls: true,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.EnvVariable, key: 'ANTHROPIC_API_KEY', signedIn: false },
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.initializeProvider();
	}

	/**
	 * Initializes the Anthropic provider using Vercel AI SDK.
	 */
	protected initializeProvider(): void {
		this.aiProvider = createAnthropic({ apiKey: this._config.apiKey });
	}

	/**
	 * Creates the AI provider instance.
	 * @returns The Anthropic provider function.
	 */
	protected createAIProvider(): any {
		return this.aiProvider;
	}

	get providerName(): string {
		return AnthropicAILanguageModel.source.provider.displayName;
	}
}