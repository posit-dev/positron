/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AnthropicLanguageModel } from './anthropic.js';

export class TokenTracker {
	private static DEFAULT_PROVIDERS = [AnthropicLanguageModel.source.provider.id];
	private _tokenUsage: Map<string, { input: number; output: number }> = new Map();
	private _enabledProviders: Set<string> = new Set([...TokenTracker.DEFAULT_PROVIDERS]);

	private readonly TOKEN_COUNT_KEY = 'positron.assistant.tokenCounts';

	constructor(private _context: vscode.ExtensionContext) {
		const tokenTrackerData = this._context.workspaceState.get(this.TOKEN_COUNT_KEY);

		if (!tokenTrackerData || typeof tokenTrackerData !== 'string') {
			// Initialize with an empty Map if no data is found
			this._tokenUsage = new Map<string, { input: number; output: number }>();
		} else {

			try {
				const parsedData = JSON.parse(tokenTrackerData);
				if (Array.isArray(parsedData)) {
					// Validate each entry has the expected structure
					const validEntries = parsedData.filter(entry =>
						Array.isArray(entry) &&
						entry.length === 2 &&
						typeof entry[0] === 'string' &&
						typeof entry[1] === 'object' &&
						entry[1] !== null &&
						typeof entry[1].input === 'number' &&
						typeof entry[1].output === 'number'
					);
					this._tokenUsage = new Map(validEntries);
				} else {
					this._tokenUsage = new Map<string, { input: number; output: number }>();
				}
			} catch (error) {
				// Handle JSON parse errors or undefined tokenTrackerData
				this._tokenUsage = new Map<string, { input: number; output: number }>();
			}
		}

		// set context for each provider's token count
		for (const [provider, tokens] of this._tokenUsage.entries()) {
			this.updateContext(provider, tokens.input, tokens.output);
		}

		// Read initial configuration
		const initialEnabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);
		this._enabledProviders = new Set([...initialEnabledProviders, ...TokenTracker.DEFAULT_PROVIDERS]);

		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('positron.assistant.approximateTokenCount')) {
				const enabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);

				const anthropicId = AnthropicLanguageModel.source.provider.id;
				this._enabledProviders = new Set([...enabledProviders, anthropicId]); // ensure anthropicId is always included

				// clear token counts for providers that are no longer enabled
				for (const provider of this._tokenUsage.keys()) {
					if (!this._enabledProviders.has(provider)) {
						this.clearTokens(provider);
					}
				}
			}
		});
	}

	public addTokens(provider: string, inputTokens: number, outputTokens: number): void {
		if (!this._enabledProviders.has(provider)) {
			return; // Skip if token counting is disabled
		}

		if (!this._tokenUsage.has(provider)) {
			this._tokenUsage.set(provider, { input: 0, output: 0 });
		}

		const currentTokens = this._tokenUsage.get(provider)!;
		currentTokens.input += inputTokens;
		currentTokens.output += outputTokens;

		this._tokenUsage.set(provider, currentTokens);
		this.updateContext(provider, currentTokens.input, currentTokens.output);
		this._context.workspaceState.update(this.TOKEN_COUNT_KEY, JSON.stringify(Array.from(this._tokenUsage.entries())));
	}

	public clearTokens(provider: string): void {
		if (this._tokenUsage.has(provider)) {
			this._tokenUsage.delete(provider);
			this.updateContext(provider);
			this._context.workspaceState.update(this.TOKEN_COUNT_KEY, JSON.stringify(Array.from(this._tokenUsage.entries())));
		}
	}

	private updateContext(provider: string, input?: number, output?: number): void {
		vscode.commands.executeCommand('setContext', `positron-assistant.${provider}.tokenCount.input`, input);
		vscode.commands.executeCommand('setContext', `positron-assistant.${provider}.tokenCount.output`, output);
	}
}
