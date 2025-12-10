/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { OpenAILanguageModel } from '../openai/openaiProvider';
import { ModelConfig } from '../../config';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils';
import {
	detectSnowflakeCredentials,
	extractSnowflakeError,
	getSnowflakeDefaultBaseUrl,
	checkForUpdatedSnowflakeCredentials
} from '../../snowflakeAuth';
import { autoconfigureWithManagedCredentials, SNOWFLAKE_MANAGED_CREDENTIALS } from '../../pwb';
import { AutoconfigureResult } from '../base/modelProvider';

/**
 * Snowflake Cortex model provider implementation.
 * Extends OpenAI provider to use Snowflake's OpenAI-compatible API.
 * Includes automatic credential refresh from connections.toml.
 */
export class SnowflakeLanguageModel extends OpenAILanguageModel {
	protected declare aiProvider: OpenAIProvider;
	private lastConnectionsTomlCheck?: number; // Timestamp of last file check

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'snowflake-cortex',
			displayName: 'Snowflake Cortex'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'autoconfigure'],
		defaults: {
			name: 'Snowflake Cortex',
			model: 'claude-4-sonnet',
			baseUrl: getSnowflakeDefaultBaseUrl(),
			toolCalls: true,
			completions: false,
			autoconfigure: { type: positron.ai.LanguageModelAutoconfigureType.Custom, message: 'Automatically configured using Snowflake credentials', signedIn: false },
		}
	};

	get providerName(): string {
		return SnowflakeLanguageModel.source.provider.displayName;
	}

	/**
	 * Gets the base URL for the Snowflake Cortex API.
	 * Overrides the parent implementation to use Snowflake-specific defaults.
	 */
	get baseUrl(): string {
		// Use the baseUrl from config or fallback to default
		return this._config.baseUrl || SnowflakeLanguageModel.source.defaults.baseUrl!;
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
	static override async autoconfigure(): Promise<AutoconfigureResult> {
		// Use the standard PWB flow for environment and settings validation
		const configureResult = await autoconfigureWithManagedCredentials(
			SNOWFLAKE_MANAGED_CREDENTIALS,
			SnowflakeLanguageModel.source.provider.id,
			SnowflakeLanguageModel.source.provider.displayName
		);

		// If PWB checks pass, get credentials and return with both token and baseUrl
		if (configureResult.signedIn) {
			const credentials = await detectSnowflakeCredentials();
			if (credentials?.token && credentials.token.trim().length > 0) {
				return {
					signedIn: configureResult.signedIn,
					message: configureResult.message,
					token: credentials.token,
					baseUrl: credentials.baseUrl
				};
			}
		}

		return { signedIn: false };
	}

	/**
	 * Parses Snowflake-specific errors.
	 * @param error The error object.
	 * @returns A user-friendly error message or undefined.
	 */
	override async parseProviderError(error: any): Promise<string | undefined> {
		// Check for Snowflake-specific errors before generic authorization errors
		if (this.providerName === SnowflakeLanguageModel.source.provider.displayName) {
			const snowflakeError = extractSnowflakeError(error);
			if (snowflakeError) {
				throw new Error(`Failed to register model configuration. Error: ${snowflakeError}`);
			}
		}

		return super.parseProviderError(error);
	}
}