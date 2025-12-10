/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ModelConfig, SecretStorage } from '../../config';
import { DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';

/**
 * Test provider that always throws errors.
 * Useful for testing error handling in the application.
 */
export class ErrorLanguageModel implements positron.ai.LanguageModelChatProvider {
	readonly name = 'Error Language Model';
	readonly provider = 'error';
	readonly id = 'error-language-model';
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;
	private readonly _message = '[ErrorLanguageModel] This language model always throws an error message.';

	constructor(
		_config: ModelConfig,
		private readonly _context?: vscode.ExtensionContext,
		private readonly _storage?: SecretStorage,
	) {
		// No additional setup needed for error model
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

	get providerName(): string {
		return ErrorLanguageModel.source.provider.displayName;
	}

	provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
		throw new Error(this._message);
	}

	provideLanguageModelChatResponse(): Promise<any> {
		throw new Error(this._message);
	}

	provideTokenCount(): Promise<number> {
		throw new Error(this._message);
	}

	resolveConnection(token: vscode.CancellationToken): Thenable<Error | undefined> {
		throw new Error(this._message);
	}

	resolveModels(token: vscode.CancellationToken): Thenable<vscode.LanguageModelChatInformation[] | undefined> {
		throw new Error(this._message);
	}
}