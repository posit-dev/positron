/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Main export file for all model providers.
 *
 * This file serves as the central hub for provider exports and utilities.
 * It aggregates all provider implementations and provides helper functions
 * for provider instantiation and auto-configuration.
 */

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ModelConfig, SecretStorage } from '../config';

// Import provider classes for use in utility functions
import { ErrorModelProvider } from './test/errorProvider';
import { EchoModelProvider } from './test/echoProvider';
import { OpenAIModelProvider } from './openai/openaiProvider';
import { OpenAICompatibleModelProvider } from './openai/openaiCompatibleProvider';
import { AnthropicModelProvider } from './anthropic/anthropicProvider';
import { AnthropicAIModelProvider } from './anthropic/anthropicVercelProvider';
import { AzureModelProvider } from './azure/azureProvider';
import { GoogleModelProvider } from './google/googleProvider';
import { VertexModelProvider } from './google/vertexProvider';
import { SnowflakeModelProvider } from './snowflake/snowflakeProvider';
import { MistralModelProvider } from './mistral/mistralProvider';
import { OllamaModelProvider } from './ollama/ollamaProvider';
import { OpenRouterModelProvider } from './openrouter/openrouterProvider';
import { AWSModelProvider } from './aws/awsBedrockProvider';
import { PositModelProvider } from './posit/positProvider';
import { ModelProvider } from './base/modelProvider.js';
import { AutoconfigureResult } from './base/modelProviderTypes.js';
import { CopilotModelProvider } from '../copilot.js';

/**
 * Type for a concrete (non-abstract) model provider constructor with static metadata.
 */
interface ConcreteModelProviderConstructor {
	new(config: ModelConfig, context: vscode.ExtensionContext, storage: SecretStorage): ModelProvider;
	source: positron.ai.LanguageModelSource;
	autoconfigure?: () => Promise<AutoconfigureResult>;
}

/**
 * Gets all available language model provider classes.
 *
 * @returns Array of all provider classes that can be instantiated
 */
export function getModelProviders(): ConcreteModelProviderConstructor[] {
	const testProviders = [
		AWSModelProvider,
		EchoModelProvider,
		ErrorModelProvider,
	];

	// Check if the user disabled the Anthropic SDK. This is for development purposes.
	const useAnthropicSdk = vscode.workspace.getConfiguration('positron.assistant').get('useAnthropicSdk', true);
	const anthropicClass = useAnthropicSdk ? AnthropicModelProvider : AnthropicAIModelProvider;

	const providers = [
		...testProviders,
		anthropicClass,
		AzureModelProvider,
		CopilotModelProvider,
		GoogleModelProvider,
		MistralModelProvider,
		OllamaModelProvider,
		OpenAIModelProvider,
		OpenAICompatibleModelProvider,
		OpenRouterModelProvider,
		PositModelProvider,
		SnowflakeModelProvider,
		VertexModelProvider,
	];
	return providers;
}

/**
 * Creates model configurations from environment variables.
 * Only compatible with providers that have an API key environment variable.
 *
 * @returns The model configurations that are configured by the environment.
 */
export async function createAutomaticModelConfigs(): Promise<ModelConfig[]> {
	const models = getModelProviders();
	const modelConfigs: ModelConfig[] = [];

	for (const model of models) {
		if (model.source.defaults.autoconfigure === undefined) {
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
			if (model.autoconfigure !== undefined) {
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
	const providerClass = getModelProviders().find((cls) => cls.source.provider.id === config.provider);
	if (!providerClass) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}
	return new providerClass(config, context, storage);
}

export { AutoconfigureResult };
