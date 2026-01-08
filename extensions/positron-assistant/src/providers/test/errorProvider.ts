/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ModelConfig, SecretStorage } from '../../config';
import { DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';
import { ModelProvider } from '../base/modelProvider';

/**
 * Test provider that always throws errors.
 * Useful for testing error handling in the application.
 */
export class ErrorModelProvider extends ModelProvider {
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;
	private readonly _message = '[ErrorModelProvider] This language model always throws an error message.';

	constructor(
		_config: ModelConfig,
		_context?: vscode.ExtensionContext,
		_storage?: SecretStorage,
	) {
		super(_config, _context, _storage);
	}

	static source = {
		type: positron.PositronLanguageModelType.Chat,
		signedIn: false,
		provider: {
			id: 'error',
			displayName: 'Error Language Model',
		},
		supportedOptions: [],
		defaults: {
			name: 'Error Language Model',
			model: 'error',
		},
	};

	/**
	 * Sends a test message - always throws an error.
	 */
	protected async sendTestMessage(modelId: string): Promise<any> {
		throw new Error(this._message);
	}

	/**
	 * Provides a chat response - always throws an error.
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		throw new Error(this._message);
	}

	/**
	 * Resolves models - always throws an error.
	 */
	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		throw new Error(this._message);
	}
}
