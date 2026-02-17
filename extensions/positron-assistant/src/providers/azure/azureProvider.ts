/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createAzure, AzureOpenAIProvider } from '@ai-sdk/azure';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../configTypes.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';
import { autoconfigureWithManagedCredentials, AZURE_MANAGED_CREDENTIALS } from '../../pwb.js';
import { log } from '../../log.js';

/** Auth provider constants -- contract with the Workbench VS Code extension. */
const AUTH_PROVIDER_ID = 'posit-workbench';
const AUTH_SCOPES = ['azure-cognitiveservices'];

/**
 * Azure OpenAI Service model provider implementation.
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
	protected declare aiProvider: AzureOpenAIProvider;
	private _hasShownAuthError = false;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.azure,
		supportedOptions: ['resourceName', 'apiKey', 'toolCalls'],
		defaults: {
			name: 'GPT 4o',
			model: 'gpt-4o',
			resourceName: undefined,
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

		// Validate that Workbench Azure settings exist before advertising as configured.
		const wbConfig = AzureModelProvider.getWorkbenchConfig();
		if (!wbConfig.resourceName || !wbConfig.deploymentName) {
			log.debug('[Azure] Workbench Azure settings not configured, skipping autoconfigure');
			return { configured: false };
		}

		return result;
	}

	/**
	 * Reads Azure OpenAI config from the Workbench extension's VS Code settings.
	 * Only used in Workbench managed mode.
	 */
	private static getWorkbenchConfig() {
		const config = vscode.workspace.getConfiguration('positWorkbench.azure.openai');
		return {
			resourceName: config.get<string>('resourceName', ''),
			deploymentName: config.get<string>('deploymentName', ''),
			apiVersion: config.get<string>('apiVersion', '2024-10-21'),
		};
	}

	protected override initializeProvider() {
		if (this.isWorkbenchManaged) {
			// Bearer token path: read config from Workbench settings.
			const wbConfig = AzureModelProvider.getWorkbenchConfig();

			// Use deploymentName as the model ID when autoconfigured
			this._config.model = wbConfig.deploymentName;

			this.aiProvider = createAzure({
				resourceName: wbConfig.resourceName,
				apiKey: '_', // Placeholder -- replaced by bearer token in authFetch
				apiVersion: wbConfig.apiVersion,
				fetch: this.authFetch.bind(this),
			});
		} else {
			// API key path: existing behavior
			this.aiProvider = createAzure({
				apiKey: this._config.apiKey,
				resourceName: this._config.resourceName,
			});
		}
	}

	/**
	 * Custom fetch that replaces the `api-key` header with a Bearer token
	 * from VS Code auth API. Only used in Workbench managed mode.
	 */
	private async authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const token = await this.getAccessToken();
		const headers = new Headers(init?.headers);
		headers.delete('api-key');
		headers.set('Authorization', `Bearer ${token}`);
		return fetch(input, { ...init, headers });
	}

	/**
	 * Gets a fresh access token from VS Code auth API.
	 * The Workbench extension's auth provider handles caching and
	 * proactive refresh via its timer.
	 */
	private async getAccessToken(): Promise<string> {
		try {
			const session = await vscode.authentication.getSession(
				AUTH_PROVIDER_ID,
				AUTH_SCOPES,
				{ createIfNone: false, silent: true }
			);

			if (!session) {
				this.handleAuthError('No Azure credentials available. Contact your Workbench administrator.');
				throw new Error('Azure OpenAI authentication unavailable.');
			}

			this._hasShownAuthError = false;
			return session.accessToken;
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
