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
import { ModelConfig } from '../config';

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
	new(config: ModelConfig, context: vscode.ExtensionContext): ModelProvider;
	source: positron.ai.LanguageModelSource;
	autoconfigure?: () => Promise<AutoconfigureResult>;
}

/**
 * Result of resolving autoconfigure credentials for a model.
 */
interface ResolvedCredentials {
	apiKey?: string;
	baseUrl?: string;
	autoconfigure: NonNullable<ModelConfig['autoconfigure']>;
}

/**
 * Resolves credentials for an autoconfigurable model based on its autoconfigure type.
 * Returns undefined if credentials cannot be resolved.
 */
async function resolveAutoconfigureCredentials(model: ConcreteModelProviderConstructor): Promise<ResolvedCredentials | undefined> {
	const { autoconfigure } = model.source.defaults;

	if (!autoconfigure) {
		return undefined;
	}

	if (autoconfigure.type === positron.ai.LanguageModelAutoconfigureType.EnvVariable) {
		const key = autoconfigure.key;
		const apiKey = key ? process.env[key] : undefined;
		if (key && apiKey) {
			return {
				apiKey,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
					key,
					signedIn: true,
				}
			};
		}
	} else if (autoconfigure.type === positron.ai.LanguageModelAutoconfigureType.Custom) {
		if (model.autoconfigure) {
			const result = await model.autoconfigure();
			if (result.configured) {
				return {
					apiKey: result.configuration?.apiKey,
					baseUrl: result.configuration?.baseUrl,
					autoconfigure: {
						type: positron.ai.LanguageModelAutoconfigureType.Custom,
						message: result.message,
						signedIn: true,
					}
				};
			}
		}
	}

	return undefined;
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

		const credentials = await resolveAutoconfigureCredentials(model);
		if (credentials) {
			const modelConfig: ModelConfig = {
				id: `${model.source.provider.id}`,
				provider: model.source.provider.id,
				type: positron.PositronLanguageModelType.Chat,
				name: model.source.provider.displayName,
				model: model.source.defaults.model,
				toolCalls: model.source.defaults.toolCalls,
				completions: model.source.defaults.completions,
				...(credentials.apiKey && { apiKey: credentials.apiKey }),
				...(credentials.baseUrl && { baseUrl: credentials.baseUrl }),
				autoconfigure: credentials.autoconfigure,
			};
			modelConfigs.push(modelConfig);
		}
	}

	return modelConfigs;
}

/**
 * Creates a new language model chat provider instance based on the configuration.
 * This is used to instantiate the appropriate provider class.
 */
export function newLanguageModelChatProvider(config: ModelConfig, context: vscode.ExtensionContext): positron.ai.LanguageModelChatProvider {
	const providerClass = getModelProviders().find((cls) => cls.source.provider.id === config.provider);
	if (!providerClass) {
		throw new Error(`Unsupported chat provider: ${config.provider}`);
	}
	return new providerClass(config, context);
}

export { AutoconfigureResult };
