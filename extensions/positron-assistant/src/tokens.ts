/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PROVIDER_METADATA } from './providerMetadata.js';

export type TokenUsage = {
	/** The number of input tokens, not including tokens read from cache. */
	inputTokens: number;
	/** The number of output tokens in responses. */
	outputTokens: number;
	/** The number of tokens that have been read from cache. */
	cachedTokens: number;
	/** Provider specific metadata with additional usage details. */
	providerMetadata?: any;
};

export function isTokenUsage(obj: any): obj is TokenUsage {
	return obj && typeof obj.inputTokens === 'number' && typeof obj.outputTokens === 'number' && typeof obj.cachedTokens === 'number';
}

// Module-level token tracker instance, initialized in initializeTokenTracking
let tokenTracker: TokenTracker;

// Registry to store token usage by request ID for individual requests
const requestTokenUsage = new Map<string, { tokens: TokenUsage; provider: string }>();

/**
 * Initialize the token tracking system. Must be called during extension activation.
 */
export function initializeTokenTracking(context: vscode.ExtensionContext): void {
	tokenTracker = new TokenTracker(context);
}

export function recordTokenUsage(provider: string, tokens: TokenUsage): void {
	tokenTracker.addTokens(provider, tokens);
}

export function clearTokenUsage(provider: string): void {
	tokenTracker.clearTokens(provider);
}

export function recordRequestTokenUsage(requestId: string, provider: string, tokens: TokenUsage): void {
	const enabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);

	enabledProviders.push(PROVIDER_METADATA.anthropic.id); // ensure anthropicId is always included

	if (!enabledProviders.includes(provider)) {
		return; // Skip if token counting is disabled for this provider
	}

	requestTokenUsage.set(requestId, { provider, tokens });
	// Clean up old entries to prevent memory leaks
	setTimeout(() => {
		requestTokenUsage.delete(requestId);
	}, 30000); // Clean up after 30 seconds
}

export function getRequestTokenUsage(requestId: string): { tokens: TokenUsage; provider: string } | undefined {
	return requestTokenUsage.get(requestId);
}

export class TokenTracker {
	private static DEFAULT_PROVIDERS = [PROVIDER_METADATA.anthropic.id];
	private _tokenUsage: Map<string, TokenUsage> = new Map();
	private _enabledProviders: Set<string> = new Set([...TokenTracker.DEFAULT_PROVIDERS]);

	private readonly TOKEN_COUNT_KEY = 'positron.assistant.tokenCounts';

	constructor(private _context: vscode.ExtensionContext) {
		const tokenTrackerData = this._context.workspaceState.get(this.TOKEN_COUNT_KEY);

		if (!tokenTrackerData || typeof tokenTrackerData !== 'string') {
			// Initialize with an empty Map if no data is found
			this._tokenUsage = new Map<string, TokenUsage>();
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
						isTokenUsage(entry[1])
					);
					this._tokenUsage = new Map(validEntries);
				} else {
					this._tokenUsage = new Map<string, TokenUsage>();
				}
			} catch (error) {
				// Handle JSON parse errors or undefined tokenTrackerData
				this._tokenUsage = new Map<string, TokenUsage>();
			}
		}

		// set context for each provider's token count
		for (const [provider, tokens] of this._tokenUsage.entries()) {
			this.updateContext(provider, tokens.inputTokens, tokens.outputTokens, tokens.cachedTokens);
		}

		// Read initial configuration
		const initialEnabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);
		this._enabledProviders = new Set([...initialEnabledProviders, ...TokenTracker.DEFAULT_PROVIDERS]);

		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('positron.assistant.approximateTokenCount')) {
				const enabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);

				const anthropicId = PROVIDER_METADATA.anthropic.id;
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

	public addTokens(provider: string, tokens: TokenUsage): void {
		if (!this._enabledProviders.has(provider)) {
			return; // Skip if token counting is disabled
		}

		if (!this._tokenUsage.has(provider)) {
			this._tokenUsage.set(provider, { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
		}

		const currentTokens = this._tokenUsage.get(provider)!;
		currentTokens.inputTokens += tokens.inputTokens;
		currentTokens.outputTokens += tokens.outputTokens;
		currentTokens.cachedTokens += tokens.cachedTokens;

		this._tokenUsage.set(provider, currentTokens);
		this.updateContext(provider, currentTokens.inputTokens, currentTokens.outputTokens, currentTokens.cachedTokens);
		this._context.workspaceState.update(this.TOKEN_COUNT_KEY, JSON.stringify(Array.from(this._tokenUsage.entries())));
	}

	public clearTokens(provider: string): void {
		if (this._tokenUsage.has(provider)) {
			this._tokenUsage.delete(provider);
			this.updateContext(provider);
			this._context.workspaceState.update(this.TOKEN_COUNT_KEY, JSON.stringify(Array.from(this._tokenUsage.entries())));
		}
	}

	private updateContext(provider: string, input?: number, output?: number, cached?: number): void {
		vscode.commands.executeCommand('setContext', `positron-assistant.${provider}.tokenCount.input`, input);
		vscode.commands.executeCommand('setContext', `positron-assistant.${provider}.tokenCount.output`, output);
		vscode.commands.executeCommand('setContext', `positron-assistant.${provider}.tokenCount.cached`, cached);
	}
}
