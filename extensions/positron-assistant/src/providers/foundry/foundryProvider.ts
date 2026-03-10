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
 * Uses the OpenAI v1 API (`{endpoint}/openai/v1/chat/completions`)
 * The model is specified in the request body (no deployment-based URLs or api-version).
 *
 * If a user provides a deployment-based URL (containing `/openai/deployments/`),
 * it is automatically converted to the v1 format by extracting the endpoint base.
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
			name: 'GPT-5.3 Chat',
			model: 'gpt-5.3-chat',
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
	 * Normalizes the raw URL from config (manual or Workbench) to the v1 format.
	 * Deployment-based URLs are converted by extracting the endpoint base.
	 */
	get baseUrl(): string {
		const rawUrl = this.isWorkbenchManaged
			? FoundryModelProvider.getWorkbenchConfig().endpoint
			: (this._config.baseUrl ?? '');
		return FoundryModelProvider.normalizeToV1Url(rawUrl);
	}

	/**
	 * Normalizes any Foundry URL to the v1 API format.
	 *
	 * Handles deployment URLs (e.g., `{endpoint}/openai/deployments/{name}/...?api-version=...`)
	 * by extracting the endpoint base. Strips query parameters since the v1 API
	 * rejects `api-version`. Appends `/openai/v1` if not already present.
	 */
	static normalizeToV1Url(rawUrl: string): string {
		let url = rawUrl.trim();

		// Strip query parameters (v1 API rejects api-version)
		const queryIndex = url.indexOf('?');
		if (queryIndex !== -1) {
			url = url.substring(0, queryIndex);
		}

		url = url.replace(/\/+$/, '');

		// Deployment URL: extract endpoint base before /openai/deployments/
		const deploymentIndex = url.indexOf('/openai/deployments/');
		if (deploymentIndex !== -1) {
			url = url.substring(0, deploymentIndex);
		}

		if (url.endsWith('/openai/v1')) {
			return url;
		}

		return `${url}/openai/v1`;
	}

	/**
	 * Returns true if the URL is a deployment-based Azure OpenAI URL.
	 * Used by the UI to show a warning when a deployment URL is entered.
	 */
	static isDeploymentUrl(rawUrl: string): boolean {
		return /\/openai\/deployments\//.test(rawUrl);
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

		if (result.configured) {
			const endpoint = FoundryModelProvider.getWorkbenchConfig().endpoint;
			result.configuration = {
				baseUrl: FoundryModelProvider.normalizeToV1Url(endpoint),
			};
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
