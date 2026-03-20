/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../configTypes.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils.js';
import { log } from '../../log.js';

/**
 * Microsoft Foundry model provider implementation.
 *
 * Uses the OpenAI v1 API (`{endpoint}/openai/v1/chat/completions`)
 * The model is specified in the request body (no deployment-based URLs or api-version).
 *
 * If a user provides a deployment-based URL (containing `/openai/deployments/`),
 * it is automatically converted to the v1 format by extracting the endpoint base.
 *
 * Credentials are obtained from the authentication extension via
 * `vscode.authentication.getSession('ms-foundry', ...)`, which transparently
 * handles both API key and Workbench-managed bearer token paths.
 *
 * @see {@link VercelModelProvider} for base class documentation
 */
export class FoundryModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: OpenAIProvider;
	private _hasShownAuthError = false;

	/**
	 * Since the v1 API uses `/chat/completions`, set this flag for correct
	 * tool result formatting.
	 */
	protected override usesChatCompletions = true;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.foundry,
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'GPT-5.3 Chat',
			model: 'gpt-5.3-chat',
			baseUrl: undefined,
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/**
	 * Gets the base URL for the Azure OpenAI v1 API.
	 *
	 * Reads from config first (manual override), then falls back to the
	 * auth extension's `authentication.foundry.baseUrl` setting.
	 * The auth extension normalizes URLs during save.
	 */
	get baseUrl(): string {
		return this._config.baseUrl
			?? vscode.workspace
				.getConfiguration('authentication.foundry')
				.get<string>('baseUrl', '');
	}

	protected override initializeProvider() {
		const baseProvider = createOpenAI({
			apiKey: '_',
			baseURL: this.baseUrl,
			fetch: this.createAuthFetch(),
		});

		// Route to .chat() for /v1/chat/completions endpoint
		const chatWrapper = ((modelId: string) => baseProvider.chat(modelId)) as OpenAIProvider;
		Object.assign(chatWrapper, baseProvider);
		this.aiProvider = chatWrapper;
	}

	/**
	 * Creates a fetch function that injects the auth session token into
	 * every request. Works for both API key sessions and PWB bearer
	 * tokens since both use `Authorization: Bearer`.
	 */
	private createAuthFetch() {
		const compatibleFetch = createOpenAICompatibleFetch(this.providerName);
		return async (input: RequestInfo, init?: RequestInit) => {
			const session = await vscode.authentication.getSession(
				'ms-foundry', [], { silent: true }
			);
			if (!session) {
				this.handleAuthError('No Foundry credentials available.');
				throw new Error('Microsoft Foundry authentication unavailable.');
			}
			this._hasShownAuthError = false;
			const headers = new Headers(init?.headers);
			headers.set('Authorization', `Bearer ${session.accessToken}`);
			return compatibleFetch(input, { ...init, headers });
		};
	}

	private handleAuthError(message: string): void {
		log.error(`[Foundry] ${message}`);
		if (!this._hasShownAuthError) {
			this._hasShownAuthError = true;
			vscode.window.showErrorMessage(`Microsoft Foundry: ${message}`);
		}
	}

	protected override async validateCredentials(): Promise<boolean> {
		const session = await vscode.authentication.getSession(
			'ms-foundry', [], { silent: true }
		);
		return !!session;
	}
}
