/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../config';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils';
import { getAllModelDefinitions } from '../../modelDefinitions';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';
import { applyModelFilters } from '../../modelFilters';

/**
 * OpenAI model provider implementation.
 *
 * **Configuration:**
 * - Provider ID: `openai-api`
 * - Required: API key from OpenAI Platform
 * - Optional: Base URL (for custom deployments), model selection
 * - Supports: Dynamic model listing from API
 *
 * **Model Filtering:**
 * This provider automatically filters out models that don't support the chat
 * completions endpoint (e.g., audio models, image models, moderation models).
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'gpt-4o',
 *   name: 'GPT-4o',
 *   provider: 'openai-api',
 *   apiKey: 'sk-...',
 *   model: 'gpt-4o',
 *   baseUrl: 'https://api.openai.com/v1'
 * };
 * const provider = new OpenAIModelProvider(config, context);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://platform.openai.com/docs for OpenAI API documentation
 */
export class OpenAIModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * The OpenAI provider instance from Vercel AI SDK.
	 */
	protected declare aiProvider: OpenAIProvider;

	/**
	 * Model name patterns to filter out (case-insensitive).
	 *
	 * These models are not suitable for chat use cases as they don't support
	 * the `/chat/completions` endpoint. They're filtered out automatically
	 * during model discovery.
	 */
	public static readonly FILTERED_MODEL_PATTERNS = [
		'audio',
		'image',
		'moderation',
		'realtime',
		'search',
		'transcribe',
		'dall-e',
		'o3-pro',
	] as const;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'openai-api',
			displayName: 'OpenAI',
			settingName: 'openAI'
		},
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'OpenAI',
			model: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			toolCalls: true
		},
	};

	/**
	 * Creates a new OpenAI provider instance.
	 *
	 * @param _config - Configuration including API key, base URL, and model selection
	 * @param _context - VS Code extension context for storage and features
	 */
	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/**
	 * Initializes the OpenAI provider using the Vercel AI SDK.
	 *
	 * Creates an OpenAI provider instance with:
	 * - Configured API key
	 * - Custom base URL (if specified)
	 * - Custom fetch implementation for request handling
	 */
	protected override initializeProvider() {
		this.aiProvider = createOpenAI({
			apiKey: this._config.apiKey,
			baseURL: this.baseUrl,
			fetch: createOpenAICompatibleFetch(this.providerName)
		});
	}

	/**
	 * Gets the base URL for the OpenAI API.
	 *
	 * Uses the configured base URL or falls back to the default OpenAI API endpoint.
	 * Trailing slashes are removed for consistency.
	 *
	 * @returns The base URL for API requests
	 */
	get baseUrl() {
		return (this._config.baseUrl ?? OpenAIModelProvider.source.defaults.baseUrl)?.replace(/\/+$/, '');
	}

	/**
	 * Provides language model chat information for available models.
	 *
	 * Overrides the base implementation to ensure models are always freshly
	 * resolved (not cached) for OpenAI, allowing dynamic model discovery.
	 *
	 * @param options - Options for providing chat information
	 * @param token - Cancellation token
	 * @returns Array of available models after filtering
	 */
	override async provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken) {
		this.logger.debug('Preparing language model chat information...');
		const models = await this.resolveModels(token) ?? [];

		this.logger.debug(`Resolved ${models.length} models.`);
		return this.filterModels(models);
	}

	/**
	 * Resolves available models from configuration or API.
	 */
	override async resolveModels(token: vscode.CancellationToken) {
		this.logger.debug('Resolving models...');

		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		const apiModels = await this.retrieveModelsFromApi(token);
		if (apiModels) {
			this.modelListing = apiModels;
			return apiModels;
		}

		return undefined;
	}

	/**
	 * Retrieves models from configuration.
	 */
	protected override retrieveModelsFromConfig() {
		const configuredModels = getAllModelDefinitions(this.providerId);
		if (configuredModels.length === 0) {
			return undefined;
		}

		this.logger.info(`Using ${configuredModels.length} configured models.`);

		const modelListing = configuredModels.map((modelDef) =>
			createModelInfo({
				id: modelDef.identifier,
				name: modelDef.name,
				family: this.providerId,
				version: modelDef.identifier,
				provider: this.providerId,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: modelDef.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT,
				defaultMaxOutput: modelDef.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
			})
		);

		return markDefaultModel(modelListing, this.providerId, this._config.model);
	}

	/**
	 * Retrieves models from the OpenAI API.
	 */
	protected override async retrieveModelsFromApi(token: vscode.CancellationToken) {
		try {
			const data = await this.fetchModelsFromAPI();
			if (!data?.data || !Array.isArray(data.data)) {
				this.logger.info('Request was successful, but no models were returned.');
				return undefined;
			}
			this.logger.info(`Successfully fetched ${data.data.length} models.`);

			const models = data.data.map((model: any) =>
				createModelInfo({
					id: model.id,
					name: model.id,
					family: this.providerId,
					version: model.id,
					provider: this.providerId,
					providerName: this.providerName,
					capabilities: this.capabilities,
					defaultMaxInput: model.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT,
					defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
				})
			);

			return markDefaultModel(models, this.providerId, this._config.model);
		} catch (error) {
			this.logger.warn('Failed to fetch models from API', error);
			return undefined;
		}
	}

	/**
	 * Filters models to remove incompatible ones.
	 *
	 * Extends the base filtering with OpenAI-specific logic to remove models
	 * that don't support chat completions (e.g., audio models, image models).
	 * Uses {@link FILTERED_MODEL_PATTERNS} to identify incompatible models.
	 *
	 * @param models - The list of models to filter
	 * @returns Filtered list of models suitable for chat completions
	 *
	 * @see {@link FILTERED_MODEL_PATTERNS} for the list of filtered patterns
	 */
	override filterModels(models: vscode.LanguageModelChatInformation[]) {
		const removedModels: string[] = [];
		const filteredModels = applyModelFilters(models, this.providerId, this.providerName)
			.filter((model: any) => {
				const modelName = model.id.toLowerCase();
				const shouldRemove = OpenAIModelProvider.FILTERED_MODEL_PATTERNS.some(pattern => {
					const regex = new RegExp(`\\b${pattern.toLowerCase()}\\b`, 'i');
					return regex.test(modelName);
				});
				if (shouldRemove) {
					removedModels.push(model.id);
				}
				return !shouldRemove;
			});

		if (removedModels.length > 0) {
			this.logger.debug(`Removed ${removedModels.length} incompatible models: ${removedModels.join(', ')}`);
		}

		if (filteredModels.length === 0) {
			this.logger.warn('No models remain after filtering.');
		} else if (filteredModels.length === 1) {
			this.logger.debug(`1 model remains after filtering: ${filteredModels[0].id}`);
		} else {
			this.logger.debug(`${filteredModels.length} models remain after filtering: ${filteredModels.map(m => m.id).join(', ')}`);
		}

		return filteredModels;
	}

	/**
	 * Fetches models from the OpenAI API.
	 */
	private async fetchModelsFromAPI(): Promise<any> {
		const modelsUrl = `${this.baseUrl}/models`;
		this.logger.info(`Fetching models from ${modelsUrl}...`);

		const response = await fetch(modelsUrl, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${this._config.apiKey}`,
				'Content-Type': 'application/json'
			}
		});

		const data = await response.json();

		if (!response.ok || data?.error) {
			this.logger.error(`Error fetching models: ${response.status} ${response.statusText} - ${JSON.stringify(data?.error?.code)}`);
			const errorMsg = `Error fetching models: ${response.status} ${response.statusText} - ${data?.error?.code || JSON.stringify(data?.error)}`;
			throw new Error(errorMsg);
		}

		return data;
	}
}
