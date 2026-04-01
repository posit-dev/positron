/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { OpenAIProvider } from '@ai-sdk/openai';
import { OpenAICompatibleModelProvider } from '../openai/openaiCompatibleProvider.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';

function isValidSnowflakeAccount(account: string): boolean {
	if (!account || typeof account !== 'string') {
		return false;
	}
	return /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(account) ||
		/^[a-zA-Z0-9_-]+$/.test(account);
}

function getSnowflakeDefaultBaseUrl(): string {
	const creds = vscode.workspace
		.getConfiguration('authentication.snowflake')
		.get<{ SNOWFLAKE_ACCOUNT?: string }>('credentials', {});
	const account = creds?.SNOWFLAKE_ACCOUNT ?? process.env.SNOWFLAKE_ACCOUNT;
	if (account && isValidSnowflakeAccount(account)) {
		return `https://${account}.snowflakecomputing.com/api/v2/cortex/v1`;
	}
	return 'https://<account_identifier>.snowflakecomputing.com/api/v2/cortex/v1';
}

/**
 * Extracts Snowflake-specific error messages with enhanced user guidance.
 * Returns the enhanced error message if this is a Snowflake-specific error, or undefined otherwise.
 */
function extractSnowflakeError(error: any): string | undefined {
	let errorMessage = '';

	if (ai.APICallError.isInstance(error) && error.responseBody) {
		try {
			const parsed = JSON.parse(error.responseBody);
			errorMessage = parsed?.error?.message || error.responseBody;
		} catch {
			errorMessage = error.responseBody;
		}
	} else {
		errorMessage = error?.message || String(error);
	}

	const isCrossRegionError =
		errorMessage.toLowerCase().includes('cross-region') ||
		errorMessage.toLowerCase().includes('region mismatch') ||
		errorMessage.toLowerCase().includes('not available in the current region') ||
		errorMessage.toLowerCase().includes('model not available') ||
		(error?.statusCode === 403 && errorMessage.toLowerCase().includes('region')) ||
		(error?.statusCode === 404 && errorMessage.toLowerCase().includes('model'));

	const isNetworkPolicyError =
		errorMessage.toLowerCase().includes('network policy') ||
		errorMessage.toLowerCase().includes('network policy is required');

	if (isCrossRegionError || isNetworkPolicyError) {
		const statusCode = error?.statusCode || error?.status || 'Unknown';

		if (isNetworkPolicyError && isCrossRegionError) {
			return `Snowflake Configuration Issue: Your Snowflake account configuration is preventing access to AI models. This appears to involve both network policies and cross-region settings. Contact your Snowflake administrator. Response Status: ${statusCode}. Technical Details: ${errorMessage}`;
		} else if (isNetworkPolicyError) {
			return `Snowflake Network Policy Issue: Your Snowflake account requires network policy configuration for AI model access. Contact your Snowflake administrator. Response Status: ${statusCode}. Details: ${errorMessage}`;
		} else {
			return `Snowflake Cross-Region Issue: The AI model may not be available in your Snowflake account's region. Contact your Snowflake administrator. Response Status: ${statusCode}. Details: ${errorMessage}`;
		}
	}

	return undefined;
}

/**
 * Snowflake Cortex model provider implementation.
 * Extends OpenAI provider to use Snowflake's OpenAI-compatible API.
 * Credentials are managed by the authentication extension.
 */
export class SnowflakeModelProvider extends OpenAICompatibleModelProvider {
	protected declare aiProvider: OpenAIProvider;
	private _lastSessionToken?: string;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.snowflake,
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'autoconfigure'],
		defaults: {
			name: 'Snowflake Cortex',
			model: 'claude-4-sonnet',
			baseUrl: getSnowflakeDefaultBaseUrl(),
			toolCalls: true,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.Custom, message: 'Automatically configured using Snowflake credentials', signedIn: false },
		}
	};

	protected override get customHeaders() {
		const envConfig = vscode.workspace.getConfiguration('environmentVariables');
		const envVars = envConfig.get<Record<string, string>>('set') ?? {};
		const partnerTag = envVars['SF_PARTNER'] || 'posit_positron';
		return { 'User-Agent': partnerTag };
	}

	/**
	 * Gets the base URL for the Snowflake Cortex API.
	 * Overrides the parent implementation to use Snowflake-specific defaults.
	 */
	override get baseUrl() {
		return this._config.baseUrl || SnowflakeModelProvider.source.defaults.baseUrl!;
	}

	/**
	 * Check if the auth extension has refreshed credentials since our last request.
	 * Preserves the per-request credential freshness check from the original implementation.
	 */
	private async checkForUpdatedCredentials(): Promise<void> {
		if (!this._config.autoconfigure?.signedIn) {
			return;
		}
		const session = await vscode.authentication.getSession(
			'snowflake-cortex', [], { silent: true }
		);
		if (!session) {
			return;
		}
		if (this._lastSessionToken !== session.accessToken) {
			this._lastSessionToken = session.accessToken;
			if (session.accessToken !== this._config.apiKey) {
				this._config.apiKey = session.accessToken;
				this.initializeProvider();
			}
		}
	}

	/**
	 * Override to check for updated credentials before making requests.
	 */
	override async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	) {
		await this.checkForUpdatedCredentials();
		return super.provideLanguageModelChatResponse(
			model, messages, options, progress, token
		);
	}

	/**
	 * Autoconfigures the Snowflake provider using auth extension credentials.
	 */
	static override async autoconfigure() {
		const enabledProviders = await positron.ai.getEnabledProviders();
		if (!enabledProviders.includes(
			SnowflakeModelProvider.source.provider.id
		)) {
			return { configured: false };
		}

		try {
			const session = await vscode.authentication.getSession(
				'snowflake-cortex', [], { silent: true }
			);
			if (session?.accessToken) {
				const baseUrl = getSnowflakeDefaultBaseUrl();
				return {
					configured: true,
					message: 'OAuth (Managed)',
					configuration: {
						apiKey: session.accessToken,
						baseUrl,
					}
				};
			}
		} catch {
			// No session available
		}

		return { configured: false };
	}

	/**
	 * Parses Snowflake-specific errors.
	 */
	override async parseProviderError(error: any) {
		if (this.providerName === SnowflakeModelProvider.source.provider.displayName) {
			const snowflakeError = extractSnowflakeError(error);
			if (snowflakeError) {
				throw new Error(`Failed to register model configuration. Error: ${snowflakeError}`);
			}
		}

		return super.parseProviderError(error);
	}
}
