/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Backward compatibility exports for model providers.
 *
 * This file maintains backward compatibility after the refactoring that extracted
 * individual provider implementations into the providers/ directory.
 *
 * All provider class implementations have been moved to separate files.
 * This file now serves as a re-export layer to maintain existing imports.
 */

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ModelConfig, SecretStorage } from './config';
import { PositLanguageModel } from './posit.js';

// Import re-exported provider classes for use in utility functions
import {
	ModelProvider,
	ErrorLanguageModel,
	EchoLanguageModel,
	OpenAILanguageModel,
	OpenAICompatibleLanguageModel,
	AnthropicLanguageModel,
	AnthropicAILanguageModel,
	AzureLanguageModel,
	GoogleLanguageModel,
	VertexLanguageModel,
	SnowflakeLanguageModel,
	MistralLanguageModel,
	OllamaLanguageModel,
	OpenRouterLanguageModel,
	AWSLanguageModel,
} from './providers/index';

// AILanguageModel is the old name for ModelProvider (for backward compatibility in this file)
const AILanguageModel = ModelProvider;

// Re-export provider classes from the new structure
export {
	// Base classes and types
	ModelProvider as AILanguageModel,  // Backward compatibility alias
	ModelProvider,
	AutoconfigureResult,
	ModelProviderLogger,

	// Error classes (using actual exported names)
	AuthenticationError,
	ConnectionError,
	ConfigurationError,
	ModelRetrievalError,
	RateLimitError,
	ModelNotFoundError,
	InvalidResponseError,
	ProviderError,

	// Error type guards
	isAuthenticationError,
	isRateLimitError,
	isProviderError,

	// Types
	ModelCapabilities,
	ProviderMetadata,
	ExtendedModelInfo,
	ConnectionTestResult,
	ModelFilter,
	ProviderInitOptions,
	ExtendedTokenUsage,

	// Test providers
	ErrorLanguageModel,
	EchoLanguageModel,

	// OpenAI providers
	OpenAILanguageModel,
	OpenAICompatibleLanguageModel,

	// Anthropic providers
	AnthropicAILanguageModel,

	// Cloud providers
	AzureLanguageModel,
	GoogleLanguageModel,
	VertexLanguageModel,
	SnowflakeLanguageModel,

	// Other providers
	MistralLanguageModel,
	OllamaLanguageModel,
	OpenRouterLanguageModel,

	// AWS providers
	AWSLanguageModel,
} from './providers/index';

// Re-export the BedrockProviderVariables type for backward compatibility
export type { BedrockProviderVariables } from './providers/aws/awsBedrockProvider';

//#endregion
//#region Module exports
export function getLanguageModels() {
	const testLanguageModels = [
		AWSLanguageModel,
		EchoLanguageModel,
		ErrorLanguageModel,
	];

	// Check if the user disabled the Anthropic SDK. This is for development purposes.
	const useAnthropicSdk = vscode.workspace.getConfiguration('positron.assistant').get('useAnthropicSdk', true);
	const anthropicClass = useAnthropicSdk ? AnthropicLanguageModel : AnthropicAILanguageModel;

	const languageModels = [
		...testLanguageModels,
		anthropicClass,
		AzureLanguageModel,
		GoogleLanguageModel,
		MistralLanguageModel,
		OllamaLanguageModel,
		OpenAILanguageModel,
		OpenAICompatibleLanguageModel,
		OpenRouterLanguageModel,
		PositLanguageModel,
		SnowflakeLanguageModel,
		VertexLanguageModel,
	];
	return languageModels;
}

/**
 * Creates model configurations from environment variables.
 * Only compatible with providers that have an API key environment variable.
 *
 * @returns The model configurations that are configured by the environment.
 */
export async function createAutomaticModelConfigs(): Promise<ModelConfig[]> {
	const models = getLanguageModels();
	const modelConfigs: ModelConfig[] = [];

	for (const model of models) {
		if (!('autoconfigure' in model.source.defaults)) {
			// Not an autoconfigurable model
			continue;
		}

		if (model.source.defaults.autoconfigure.type === positron.ai.LanguageModelAutoconfigureType.EnvVariable) {
			// Handle environment variable based auto-configuration
			const key = model.source.defaults.autoconfigure.key;
			// pragma: allowlist nextline secret
			const apiKey = key ? process.env[key] : undefined;

			if (key && apiKey) {
				const modelConfig: ModelConfig = {
					id: `${model.source.provider.id}`,
					provider: model.source.provider.id,
					type: positron.PositronLanguageModelType.Chat,
					name: model.source.provider.displayName,
					model: model.source.defaults.model,
					apiKey: apiKey,
					toolCalls: model.source.defaults.toolCalls,
					completions: model.source.defaults.completions,
					autoconfigure: {
						type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
						key: key,
						signedIn: true,
					}
				};
				modelConfigs.push(modelConfig);
			}
		} else if (model.source.defaults.autoconfigure.type === positron.ai.LanguageModelAutoconfigureType.Custom) {
			// Handle custom auto-configuration
			if ('autoconfigure' in model && model.autoconfigure) {
				const result = await model.autoconfigure();
				if (result.configured) {
					const modelConfig: ModelConfig = {
						id: `${model.source.provider.id}`,
						provider: model.source.provider.id,
						type: positron.PositronLanguageModelType.Chat,
						name: model.source.provider.displayName,
						model: model.source.defaults.model,
						// Apply configuration from autoconfigure result
						...(result.configuration?.apiKey && { apiKey: result.configuration.apiKey }),
						...(result.configuration?.baseUrl && { baseUrl: result.configuration.baseUrl }),
						// pragma: allowlist nextline secret
						autoconfigure: {
							type: positron.ai.LanguageModelAutoconfigureType.Custom,
							message: result.message,
							signedIn: true
						}
					};
					modelConfigs.push(modelConfig);
				}
			}
		}
	}

	return modelConfigs;
}

/**
 * Creates a new language model chat provider instance based on the configuration.
 * This is used to instantiate the appropriate provider class.
 */
export function newLanguageModelChatProvider(config: ModelConfig, context: vscode.ExtensionContext, storage: SecretStorage): positron.ai.LanguageModelChatProvider {
	const providerClass = getLanguageModels().find((cls) => cls.source.provider.id === config.provider);
	if (!providerClass) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}
	return new providerClass(config, context, storage);
}
