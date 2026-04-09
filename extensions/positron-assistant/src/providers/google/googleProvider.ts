/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig } from '../../configTypes.js';
import { PROVIDER_METADATA } from '../../providerMetadata.js';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { getCustomModels } from '../../modelDefinitions';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';
import { applyModelFilters } from '../../modelFilters';

/** A single model entry from the Google Generative AI models list endpoint. */
interface GoogleModelInfo {
	name: string;
	displayName?: string;
	description?: string;
	inputTokenLimit?: number;
	outputTokenLimit?: number;
	supportedGenerationMethods?: string[];
}

/** Response from the Google Generative AI models list endpoint. */
interface GoogleModelsResponse {
	models?: GoogleModelInfo[];
	nextPageToken?: string;
}

/**
 * Google Gemini model provider implementation.
 *
 * **Configuration:**
 * - Provider ID: `google`
 * - Display Name: `Gemini Code Assist`
 * - Required: API key from Google AI Studio
 * - Optional: Custom base URL, model selection
 * - Supports: Tool calling and completions
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'gemini-2-flash',
 *   name: 'Gemini 2.0 Flash',
 *   provider: 'google',
 *   apiKey: 'your-api-key',
 *   model: 'gemini-2.5-flash',
 *   baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
 * };
 * const provider = new GoogleModelProvider(config, context, storage);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 * @see https://ai.google.dev/ for Google Generative AI documentation
 */
export class GoogleModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * The Google Generative AI provider instance from Vercel AI SDK.
	 */
	protected declare aiProvider: GoogleGenerativeAIProvider;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.google,
		supportedOptions: ['baseUrl', 'apiKey'],
		defaults: {
			name: 'Gemini 2.5 Flash',
			model: 'gemini-2.5-flash',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			apiKey: undefined,
			toolCalls: true
		},
	};

	/**
	 * Patterns for filtering out non-chat Google models.
	 */
	private static readonly FILTERED_MODEL_PATTERNS = [
		'embedding',
		'tts',
		'imagen',
		'aqa',
		'live',
		'native-audio',
		'learnlm',
		'bisimulation',
	];

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/**
	 * Initializes the Google Generative AI provider.
	 */
	protected override initializeProvider() {
		this.aiProvider = createGoogleGenerativeAI({
			apiKey: this._config.apiKey,
			baseURL: this._config.baseUrl,
		});
	}

	/**
	 * Resolves available models from configuration or the Google API.
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
		const configuredModels = getCustomModels(this.providerId);
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
	 * Retrieves models from the Google Generative AI API.
	 */
	protected override async retrieveModelsFromApi(_token: vscode.CancellationToken) {
		try {
			const allModels = await this.fetchModelsFromAPI();
			if (!allModels || allModels.length === 0) {
				this.logger.info('Request was successful, but no models were returned.');
				return undefined;
			}
			this.logger.info(`Successfully fetched ${allModels.length} models.`);

			const models = allModels.map((model) => {
				const id = model.name.replace(/^models\//, '');
				return createModelInfo({
					id,
					name: model.displayName ?? id,
					family: this.providerId,
					version: id,
					provider: this.providerId,
					providerName: this.providerName,
					capabilities: this.capabilities,
					defaultMaxInput: model.inputTokenLimit ?? DEFAULT_MAX_TOKEN_INPUT,
					defaultMaxOutput: model.outputTokenLimit ?? DEFAULT_MAX_TOKEN_OUTPUT
				});
			});

			return markDefaultModel(models, this.providerId, this._config.model);
		} catch (error) {
			this.logger.warn('Failed to fetch models from API', error);
			return undefined;
		}
	}

	/**
	 * Filters models to remove non-chat Google models.
	 */
	override filterModels(models: vscode.LanguageModelChatInformation[]) {
		const removedModels: string[] = [];
		const filteredModels = applyModelFilters(models, this.providerId, this.providerName)
			.filter((model) => {
				const modelId = model.id.toLowerCase();
				const shouldRemove = GoogleModelProvider.FILTERED_MODEL_PATTERNS.some(pattern => {
					const regex = new RegExp(`\\b${pattern.toLowerCase()}\\b`, 'i');
					return regex.test(modelId);
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
	 * Fetches the list of models from the Google Generative AI API,
	 * handling pagination.
	 */
	private async fetchModelsFromAPI(): Promise<GoogleModelInfo[]> {
		const baseUrl = (this._config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
		const allModels: GoogleModelInfo[] = [];
		let pageToken: string | undefined;

		do {
			const url = new URL(`${baseUrl}/models`);
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}

			this.logger.info(`Fetching models from ${url.toString()}...`);

			const response = await fetch(url.toString(), {
				method: 'GET',
				headers: {
					'x-goog-api-key': this._config.apiKey ?? '',
				},
			});

			if (!response.ok) {
				throw new Error(`Google API returned ${response.status}: ${response.statusText}`);
			}

			const data: GoogleModelsResponse = await response.json();
			if (!Array.isArray(data.models)) {
				break;
			}

			// Only include models that support generateContent
			const chatModels = data.models.filter((m) =>
				Array.isArray(m.supportedGenerationMethods) &&
				m.supportedGenerationMethods.includes('generateContent')
			);
			allModels.push(...chatModels);

			pageToken = data.nextPageToken;
		} while (pageToken);

		return allModels;
	}
}
