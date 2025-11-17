/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAllModelDefinitions } from './modelDefinitions.js';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT, MIN_TOKEN_LIMIT } from './constants.js';
import { log } from './extension.js';

/**
 * Type definition for token limits configuration from user settings.
 */
export interface TokenLimits {
	maxInput: Record<string, number>;
	maxOutput: Record<string, number>;
}

/**
 * Retrieves user-configured token limits from workspace settings.
 * These settings allow users to override default token limits for specific models.
 *
 * @returns Object containing maxInput and maxOutput token limits by model ID
 */
export function getUserTokenLimits(): TokenLimits {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	return {
		maxInput: config.get('maxInputTokens', {}),
		maxOutput: config.get('maxOutputTokens', {})
	};
}

/**
 * Determines if a model should be marked as the default for a given provider.
 *
 * This function checks:
 * 1. User-configured default models for the provider
 * 2. Falls back to provider-specific default patterns
 *
 * @param provider The provider ID (e.g., 'anthropic-api', 'openai-compatible)
 * @param id The model ID to check
 * @param name Optional model display name to check against
 * @param defaultMatch Optional fallback pattern to match against (provider-specific)
 * @returns true if this model should be the default
 */
export function isDefaultUserModel(
	provider: string,
	id: string,
	name?: string,
	defaultMatch?: string
): boolean {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const defaultModels = config.get<Record<string, string>>('defaultModels') || {};

	// Check user-configured default for this provider
	if (provider in defaultModels) {
		const userDefault = defaultModels[provider];
		if (id.includes(userDefault) || name?.includes(userDefault)) {
			return true;
		}
	}

	// Fall back to provider-specific default pattern if provided
	if (defaultMatch) {
		return id.includes(defaultMatch);
	}

	return false;
}

/**
 * Resolves the maximum token count for a model with proper fallback hierarchy.
 *
 * Priority order:
 * 1. User override from workspace settings (maxInputTokens/maxOutputTokens)
 * 2. Model definition limits from getAllModelDefinitions()
 * 3. Provider-specific defaults
 * 4. Global defaults
 *
 * Includes validation to ensure minimum token limit with helpful warnings.
 *
 * @param id The model ID to resolve tokens for
 * @param type Whether to resolve 'input' or 'output' tokens
 * @param provider The provider ID (e.g., 'anthropic-api', 'posit-ai')
 * @param providerDefault Optional provider-specific default (overrides global default)
 * @param providerName Optional provider display name for logging
 * @returns The resolved token limit
 */
export function getMaxTokens(
	id: string,
	type: 'input' | 'output',
	provider: string,
	providerDefault?: number,
	providerName?: string
): number {
	const globalDefault = type === 'input' ? DEFAULT_MAX_TOKEN_INPUT : DEFAULT_MAX_TOKEN_OUTPUT;
	const defaultTokens = providerDefault ?? globalDefault;

	// Get model-specific limits from definitions
	const configuredModels = getAllModelDefinitions(provider);
	const fixedValue = type === 'input'
		? configuredModels?.find(m => m.identifier === id)?.maxInputTokens
		: configuredModels?.find(m => m.identifier === id)?.maxOutputTokens;
	let maxTokens = fixedValue ?? defaultTokens;

	// Apply user overrides from workspace settings
	const configKey = type === 'input' ? 'maxInputTokens' : 'maxOutputTokens';
	const tokensConfig: Record<string, number> = vscode.workspace.getConfiguration('positron.assistant').get(configKey, {});
	for (const [key, value] of Object.entries(tokensConfig)) {
		if (id.indexOf(key) !== -1 && value) {
			if (typeof value !== 'number') {
				log.warn(`[${providerName ?? provider}] Invalid ${configKey} '${value}' for ${key} (${id}); ignoring`);
				continue;
			}
			if (value < MIN_TOKEN_LIMIT) {
				log.warn(`[${providerName ?? provider}] Specified ${configKey} '${value}' for ${key} (${id}) is too low; using ${MIN_TOKEN_LIMIT} instead`);
				maxTokens = MIN_TOKEN_LIMIT;
			} else {
				maxTokens = value;
			}
			break;
		}
	}

	log.trace(`[${providerName ?? provider}] Setting ${configKey} for (${id}) to ${maxTokens}`);
	return maxTokens;
}

/**
 * Parameters for creating a language model chat information object.
 */
export interface CreateModelInfoParams {
	/** The unique model ID */
	id: string;
	/** The display name of the model */
	name: string;
	/** The provider/family of the model */
	family: string;
	/** The version identifier of the model */
	version: string;
	/** The provider ID for token resolution */
	provider: string;
	/** The provider display name for logging */
	providerName: string;
	/** Model capabilities */
	capabilities?: vscode.LanguageModelChatInformation['capabilities'];
	/** Optional default max input tokens (overrides model definition defaults) */
	defaultMaxInput?: number;
	/** Optional default max output tokens (overrides model definition defaults) */
	defaultMaxOutput?: number;
}

/**
 * Creates a standardized LanguageModelChatInformation object.
 *
 * This shared utility ensures consistent model information creation across all providers
 * while applying the proper token resolution. Default model selection is handled separately
 * by the markDefaultModel function to avoid duplication.
 *
 * @param params The parameters for creating the model information
 * @returns A complete LanguageModelChatInformation object with isDefault set to false
 */
export function createModelInfo(params: CreateModelInfoParams): vscode.LanguageModelChatInformation {
	const {
		id,
		name,
		family,
		version,
		provider,
		providerName,
		capabilities = { vision: true, toolCalling: true, agentMode: true },
		defaultMaxInput,
		defaultMaxOutput
	} = params;

	return {
		id,
		name,
		family,
		version,
		maxInputTokens: getMaxTokens(id, 'input', provider, defaultMaxInput, providerName),
		maxOutputTokens: getMaxTokens(id, 'output', provider, defaultMaxOutput, providerName),
		capabilities,
		isDefault: false,
		isUserSelectable: true,
	};
}

/**
 * Marks models as default, ensuring only one default per provider.
 *
 * This utility function standardizes default model selection across all providers.
 * It uses the isDefaultUserModel logic to determine which model should be default,
 * and ensures exactly one model is marked as default per provider.
 *
 * @param models Array of models to process
 * @param provider The provider ID (used for default model detection)
 * @param defaultMatch Optional fallback pattern to match against for default selection
 * @returns Array of models with exactly one marked as default
 */
export function markDefaultModel(
	models: vscode.LanguageModelChatInformation[],
	provider: string,
	defaultMatch?: string
): vscode.LanguageModelChatInformation[] {
	if (models.length === 0) {
		return models;
	}

	// Mark models as default, ensuring only one default per provider
	let hasDefault = false;
	const updatedModels = models.map((model) => {
		if (!hasDefault && isDefaultUserModel(provider, model.id, model.name, defaultMatch)) {
			hasDefault = true;
			return { ...model, isDefault: true };
		} else {
			return { ...model, isDefault: false };
		}
	});

	// If no models match the default criteria, make the first model the default
	if (updatedModels.length > 0 && !hasDefault) {
		updatedModels[0] = {
			...updatedModels[0],
			isDefault: true,
		};
	}

	return updatedModels;
}
