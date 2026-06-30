/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAllModelDefinitions } from './modelDefinitions.js';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT, DEFAULT_MODEL_CAPABILITIES } from './constants.js';
import { log } from './log.js';

/**
 * Finds the index of the best matching model for a pattern.
 * Prefers exact ID or name match over partial match. Matching is case-insensitive.
 *
 * @param models Array of models to search
 * @param pattern Pattern to match against model ID or name
 * @returns Index of matching model, or -1 if no match
 */
export function findMatchingModelIndex(
	models: vscode.LanguageModelChatInformation[],
	pattern: string
): number {
	const patternLower = pattern.toLowerCase();
	let firstPartialMatchIndex = -1;

	for (let i = 0; i < models.length; i++) {
		const model = models[i];
		const idLower = model.id.toLowerCase();
		const nameLower = model.name?.toLowerCase() ?? '';

		// Exact match on ID or name - use it immediately
		if (idLower === patternLower || nameLower === patternLower) {
			return i;
		}

		// Track first partial match (includes pattern in id or name)
		if (firstPartialMatchIndex === -1) {
			if (idLower.includes(patternLower) || nameLower.includes(patternLower)) {
				firstPartialMatchIndex = i;
			}
		}
	}

	return firstPartialMatchIndex;
}

/**
 * Resolves the maximum token count for a model with proper fallback hierarchy.
 *
 * Priority order:
 * 1. Model definition limits from getAllModelDefinitions()
 * 2. Provider-specific defaults
 * 3. Global defaults
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
	const maxTokens = fixedValue ?? defaultTokens;

	log.trace(`[${providerName ?? provider}] Setting max ${type} tokens for (${id}) to ${maxTokens}`);
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
	capabilities?: vscode.LanguageModelChatCapabilities;
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
		capabilities = DEFAULT_MODEL_CAPABILITIES,
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
 * Priority order:
 * 1. Provider-specific defaultMatch pattern (exact match preferred, then partial)
 * 2. First model in list
 *
 * @param models Array of models to process
 * @param provider The provider ID (used for default model detection)
 * @param defaultMatch Optional fallback pattern to match against for default selection
 * @returns Array of models with exactly one marked as default
 */
export function markDefaultModel(
	models: vscode.LanguageModelChatInformation[],
	_provider: string,
	defaultMatch?: string
): vscode.LanguageModelChatInformation[] {
	if (models.length === 0) {
		return models;
	}

	let defaultModelIndex = -1;

	if (defaultMatch) {
		defaultModelIndex = findMatchingModelIndex(models, defaultMatch);
	}

	if (defaultModelIndex === -1) {
		defaultModelIndex = 0;
	}

	return models.map((model, index) => ({
		...model,
		isDefault: index === defaultModelIndex,
	}));
}
