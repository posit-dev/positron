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
import { autoconfigureWithManagedCredentials, AZURE_MANAGED_CREDENTIALS } from '../../pwb.js';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils.js';
import { log } from '../../log.js';

/** Auth provider constants -- contract with the Workbench VS Code extension. */
const AUTH_PROVIDER_ID = 'posit-workbench';
const AUTH_SCOPES = ['azure-cognitiveservices'];

/**
 * Azure OpenAI Service model provider implementation.
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
export class AzureModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	protected declare aiProvider: OpenAIProvider;
	private _hasShownAuthError = false;

	/**
	 * Since the v1 API uses `/chat/completions`, set this flag for correct
	 * tool result formatting.
	 */
	protected override usesChatCompletions = true;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.azure,
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'Model Router',
			model: 'model-router',
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
			const wbConfig = AzureModelProvider.getWorkbenchConfig();
			return `${wbConfig.endpoint.replace(/\/+$/, '')}/openai/v1`;
		}
		// Manual mode: user provides full base URL
		return (this._config.baseUrl ?? '').replace(/\/+$/, '');
	}

	/**
	 * Autoconfigures using Workbench managed credentials.
	 * Returns { configured: false } when not on PWB, credentials unavailable,
	 * or Workbench Azure settings are not configured.
	 */
	static override async autoconfigure() {
		const result = await autoconfigureWithManagedCredentials(
			AZURE_MANAGED_CREDENTIALS,
			AzureModelProvider.source.provider.id,
			AzureModelProvider.source.provider.displayName
		);
		if (!result.configured) {
			return result;
		}

		// Validate that Workbench Azure endpoint exists before advertising as configured.
		const wbConfig = AzureModelProvider.getWorkbenchConfig();
		if (!wbConfig.endpoint) {
			log.debug('[Azure] Workbench endpoint not configured, skipping autoconfigure');
			return { configured: false };
		}

		return result;
	}

	/**
	 * Reads Azure OpenAI config from the Workbench extension's VS Code settings.
	 * Only used in Workbench managed mode.
	 *
	 * Supports both the new `endpoint` setting and the deprecated `resourceName`
	 * setting (which constructs an endpoint URL automatically).
	 */
	private static getWorkbenchConfig() {
		const config = vscode.workspace.getConfiguration('positWorkbench.azure.openai');
		const endpoint = config.get<string>('endpoint', '');
		const resourceName = config.get<string>('resourceName', '');
		return {
			endpoint: endpoint || (resourceName ? `https://${resourceName}.openai.azure.com` : ''),
		};
	}

	protected override initializeProvider() {
		if (this.isWorkbenchManaged) {
			// Bearer token path: use OpenAI SDK with composed auth + compatibility fetch
			const baseProvider = createOpenAI({
				apiKey: '_', // Placeholder, replaced by bearer token in managed fetch
				baseURL: this.baseUrl,
				fetch: this.createManagedFetch(),
			});

			// Route to .chat() for /v1/chat/completions endpoint
			const chatWrapper = ((modelId: string) => baseProvider.chat(modelId)) as OpenAIProvider;
			Object.assign(chatWrapper, baseProvider);
			this.aiProvider = chatWrapper;
		} else {
			// API key path: standard OpenAI-compatible setup
			const baseProvider = createOpenAI({
				apiKey: this._config.apiKey,
				baseURL: this.baseUrl,
				fetch: createOpenAICompatibleFetch(this.providerName),
			});

			// Route to .chat() for /v1/chat/completions endpoint
			const chatWrapper = ((modelId: string) => baseProvider.chat(modelId)) as OpenAIProvider;
			Object.assign(chatWrapper, baseProvider);
			this.aiProvider = chatWrapper;
		}
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
	 * Gets a fresh access token from the Workbench extension.
	 * Uses a direct command to bypass VS Code's auth authorization layer,
	 * which would otherwise require a user-facing approval prompt.
	 * The Workbench extension handles token caching and proactive refresh.
	 */
	private async getAccessToken(): Promise<string> {
		try {
			const token = await vscode.commands.executeCommand<string | undefined>(
				'posit-workbench.getAzureOpenAIToken'
			);

			if (!token) {
				this.handleAuthError('No Azure credentials available. Contact your Workbench administrator.');
				throw new Error('Azure OpenAI authentication unavailable.');
			}

			this._hasShownAuthError = false;
			return token;
		} catch (e) {
			if (e instanceof Error && e.message === 'Azure OpenAI authentication unavailable.') {
				throw e;
			}
			this.handleAuthError(`Failed to get Azure credentials: ${e instanceof Error ? e.message : String(e)}`);
			throw new Error('Azure OpenAI authentication unavailable.');
		}
	}

	private handleAuthError(message: string): void {
		log.error(`[Azure] ${message}`);
		if (!this._hasShownAuthError) {
			this._hasShownAuthError = true;
			vscode.window.showErrorMessage(`Azure OpenAI: ${message}`);
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
