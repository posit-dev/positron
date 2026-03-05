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
import { autoconfigureWithManagedCredentials, hasManagedCredentials, FOUNDRY_MANAGED_CREDENTIALS } from '../../pwb.js';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils.js';
import { log } from '../../log.js';

/**
 * Microsoft Foundry model provider implementation.
 *
 * Uses the OpenAI v1 API (`{endpoint}/openai/v1/chat/completions`) which is
 * compatible with both `.openai.azure.com` and `.services.ai.azure.com` endpoints.
 * The model is specified in the request body (no deployment-based URLs or api-version).
 *
 * Supports two authentication paths within a single class:
 * - **API key** (manual): User configures via settings UI
 * - **Bearer token** (Workbench managed): Autoconfigured via Posit Workbench delegated credentials
 *
 * The auth path is determined by `this._config.autoconfigure?.signedIn`,
 * following the Snowflake provider pattern.
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
			name: 'GPT-4.1',
			model: 'gpt-4.1',
			baseUrl: undefined,
			toolCalls: true,
			autoconfigure: {
				type: positron.ai.LanguageModelAutoconfigureType.Custom,
				message: '',
				signedIn: false,
			},
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/** Whether this instance was autoconfigured with Workbench managed credentials. */
	private get isWorkbenchManaged(): boolean {
		return this._config.autoconfigure?.signedIn === true;
	}

	/**
	 * Gets the base URL for the Azure OpenAI v1 API.
	 *
	 * In managed mode, constructs from the Workbench endpoint setting.
	 * In manual mode, uses the user-provided baseUrl.
	 */
	get baseUrl(): string {
		if (this.isWorkbenchManaged) {
			const wbConfig = FoundryModelProvider.getWorkbenchConfig();
			return `${wbConfig.endpoint.replace(/\/+$/, '')}/openai/v1`;
		}
		// Manual mode: user provides full base URL
		return (this._config.baseUrl ?? '').replace(/\/+$/, '');
	}

	/**
	 * Autoconfigures using Workbench managed credentials.
	 * Returns { configured: false } when not on PWB, credentials unavailable,
	 * or Workbench Foundry settings are not configured.
	 */
	static override async autoconfigure() {
		if (!hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
			log.debug('[Foundry] Workbench endpoint not configured, skipping autoconfigure');
			return { configured: false };
		}

		const result = await autoconfigureWithManagedCredentials(
			FOUNDRY_MANAGED_CREDENTIALS,
			FoundryModelProvider.source.provider.id,
			FoundryModelProvider.source.provider.displayName
		);
		if (!result.configured) {
			return result;
		}
		return result;
	}

	/**
	 * Reads Foundry config from the Workbench extension's VS Code settings.
	 * Only used in Workbench managed mode.
	 */
	private static getWorkbenchConfig() {
		const config = vscode.workspace.getConfiguration('positWorkbench.foundry');
		return {
			endpoint: config.get<string>('endpoint', ''),
		};
	}

	protected override initializeProvider() {
		const baseProvider = createOpenAI({
			apiKey: this.isWorkbenchManaged ? '_' : this._config.apiKey,
			baseURL: this.baseUrl,
			fetch: this.isWorkbenchManaged
				? this.createManagedFetch()
				: createOpenAICompatibleFetch(this.providerName),
		});

		// Route to .chat() for /v1/chat/completions endpoint
		const chatWrapper = ((modelId: string) => baseProvider.chat(modelId)) as OpenAIProvider;
		Object.assign(chatWrapper, baseProvider);
		this.aiProvider = chatWrapper;
	}

	/**
	 * Creates a fetch function that composes bearer token injection with
	 * the OpenAI-compatible fetch wrapper (which handles request/response fixes).
	 * Only used in Workbench managed mode.
	 */
	private createManagedFetch(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
		const compatibleFetch = createOpenAICompatibleFetch(this.providerName);
		return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
			const token = await this.getAccessToken();
			const headers = new Headers(init?.headers);
			headers.set('Authorization', `Bearer ${token}`);
			return compatibleFetch(input, { ...init, headers });
		};
	}

	/**
	 * Gets a fresh access token via VS Code's Authentication API.
	 * The posit-workbench provider is listed in product.json's
	 * trustedExtensionAuthAccess, so no consent dialog is shown.
	 * The Workbench extension handles token caching and proactive refresh.
	 */
	private async getAccessToken(): Promise<string> {
		try {
			const session = await vscode.authentication.getSession(
				'posit-workbench',
				['msfoundry'],
				{ silent: true }
			);

			if (!session) {
				this.handleAuthError('No Foundry credentials available. Contact your Workbench administrator.');
				throw new Error('Microsoft Foundry authentication unavailable.');
			}

			this._hasShownAuthError = false;
			return session.accessToken;
		} catch (e) {
			if (e instanceof Error && e.message === 'Microsoft Foundry authentication unavailable.') {
				throw e;
			}
			this.handleAuthError(`Failed to get Foundry credentials: ${e instanceof Error ? e.message : String(e)}`);
			throw new Error('Microsoft Foundry authentication unavailable.');
		}
	}

	private handleAuthError(message: string): void {
		log.error(`[Foundry] ${message}`);
		if (!this._hasShownAuthError) {
			this._hasShownAuthError = true;
			vscode.window.showErrorMessage(`Microsoft Foundry: ${message}`);
		}
	}

	/**
	 * Validates credentials. For Workbench managed mode, checks for an
	 * available auth session. For API key mode, uses base class behavior.
	 */
	protected override async validateCredentials(): Promise<boolean> {
		if (this.isWorkbenchManaged) {
			try {
				await this.getAccessToken();
				return true;
			} catch {
				return false;
			}
		}
		return super.validateCredentials();
	}
}
