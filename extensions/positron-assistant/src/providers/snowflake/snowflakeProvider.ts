/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { OpenAIModelProvider } from '../openai/openaiProvider';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils';
import {
	detectSnowflakeCredentials,
	extractSnowflakeError,
	getSnowflakeDefaultBaseUrl,
	checkForUpdatedSnowflakeCredentials
} from './snowflakeAuth';
import { autoconfigureWithManagedCredentials, SNOWFLAKE_MANAGED_CREDENTIALS } from '../../pwb';
import { PROVIDER_METADATA } from '../../providerMetadata.js';

/**
 * Snowflake Cortex model provider implementation.
 * Extends OpenAI provider to use Snowflake's OpenAI-compatible API.
 * Includes automatic credential refresh from connections.toml.
 */
export class SnowflakeModelProvider extends OpenAIModelProvider {
	protected declare aiProvider: OpenAIProvider;
	private lastConnectionsTomlCheck?: number; // Timestamp of last file check

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

	/**
	 * Gets the base URL for the Snowflake Cortex API.
	 * Overrides the parent implementation to use Snowflake-specific defaults.
	 */
	override get baseUrl() {
		// Use the baseUrl from config or fallback to default
		return this._config.baseUrl || SnowflakeModelProvider.source.defaults.baseUrl!;
	}

	/**
	 * Check if connections.toml has been modified since our last check and update token if needed.
	 */
	private async checkForUpdatedCredentials(): Promise<void> {
		const result = await checkForUpdatedSnowflakeCredentials(
			this.lastConnectionsTomlCheck,
			this._config.apiKey
		);

		if (result.updated && result.credentials) {
			this._config.apiKey = result.credentials.token;
			if (result.credentials.baseUrl && result.credentials.baseUrl !== this._config.baseUrl) {
				this._config.baseUrl = result.credentials.baseUrl;
			}

			// Recreate the provider with updated credentials
			this.aiProvider = createOpenAI({
				apiKey: result.credentials.token,
				baseURL: this.baseUrl,
				fetch: createOpenAICompatibleFetch(this.providerName)
			});

			this.logger.info(`Refreshed credentials for account: ${result.credentials.account}`);
		}
		this.lastConnectionsTomlCheck = result.lastModified;
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
		return super.provideLanguageModelChatResponse(model, messages, options, progress, token);
	}

	/**
	 * Autoconfigures the Snowflake provider using managed credentials.
	 * @returns The autoconfiguration result.
	 */
	static override async autoconfigure() {
		// Use the standard PWB flow for environment and settings validation
		const configureResult = await autoconfigureWithManagedCredentials(
			SNOWFLAKE_MANAGED_CREDENTIALS,
			SnowflakeModelProvider.source.provider.id,
			SnowflakeModelProvider.source.provider.displayName
		);

		// If PWB checks pass, get credentials and return with both token and baseUrl
		if (configureResult.configured) {
			const credentials = await detectSnowflakeCredentials();
			if (credentials?.token && credentials.token.trim().length > 0) {
				return {
					configured: true,
					message: configureResult.message,
					configuration: {
						apiKey: credentials.token,
						baseUrl: credentials.baseUrl
					}
				};
			}
		}

		return { configured: false };
	}

	/**
	 * Parses Snowflake-specific errors.
	 * @param error The error object.
	 * @returns A user-friendly error message or undefined.
	 */
	override async parseProviderError(error: any) {
		// Check for Snowflake-specific errors before generic authorization errors
		if (this.providerName === SnowflakeModelProvider.source.provider.displayName) {
			const snowflakeError = extractSnowflakeError(error);
			if (snowflakeError) {
				throw new Error(`Failed to register model configuration. Error: ${snowflakeError}`);
			}
		}

		return super.parseProviderError(error);
	}
}
