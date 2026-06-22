/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAiModelsKeyForProvider, getSettingNameForProvider } from './providerMetadata.js';

export interface ModelDefinition {
	name: string;
	identifier: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	promptCaching?: boolean;
}

/**
 * Get custom models from VS Code settings for a specific provider.
 *
 * Reads from ai.models.<key> (new namespace) first, then falls back to
 * positron.assistant.models.overrides.<settingName> for users who have not yet
 * restarted since the startup migration ran.
 */
export function getCustomModels(providerId: string): ModelDefinition[] {
	const aiModelsKey = getAiModelsKeyForProvider(providerId);
	if (aiModelsKey) {
		const newModels = vscode.workspace
			.getConfiguration('ai')
			.get<ModelDefinition[]>(`models.${aiModelsKey}`);
		if (newModels && newModels.length > 0) {
			return newModels;
		}
	}

	// Legacy fallback: read from positron.assistant.models.overrides.*
	const settingName = getSettingNameForProvider(providerId);
	if (settingName) {
		const legacyModels = vscode.workspace
			.getConfiguration('positron.assistant')
			.get<ModelDefinition[]>(`models.overrides.${settingName}`);
		if (legacyModels && legacyModels.length > 0) {
			return legacyModels;
		}
	}

	return [];
}

/**
 * Built-in model definitions that serve as fallback defaults when no user configuration
 * is provided and dynamic model querying is not available or fails.
 */
const builtInModelDefinitions = new Map<string, ModelDefinition[]>([
	['google', [
		{
			name: 'Gemini 2.5 Flash',
			identifier: 'gemini-2.5-flash',
			maxOutputTokens: 65_536, // reference: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
		},
		{
			name: 'Gemini 2.5 Pro',
			identifier: 'gemini-2.5-pro',
			maxOutputTokens: 65_536, // reference: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
		},
	]],
	// Microsoft Foundry models -- model-router means model routing is handled by Foundry.
	// Any other models must be configured by user or admin.
	['ms-foundry', [
		{
			name: 'Model Router',
			identifier: 'model-router',
		},
	]],
	// Model listing reference: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api#model-availability
	['snowflake-cortex', [
		{
			name: 'Claude Haiku 4.5',
			identifier: 'claude-haiku-4-5',
			maxInputTokens: 200_000, // Snowflake Cortex AI model context limit
		},
		{
			name: 'Claude Opus 4.5',
			identifier: 'claude-opus-4-5',
			maxInputTokens: 200_000, // Snowflake Cortex AI model context limit
		},
		{
			name: 'Claude Opus 4.6',
			identifier: 'claude-opus-4-6',
			maxInputTokens: 200_000, // Snowflake Cortex AI model context limit
		},
		{
			name: 'Claude Sonnet 4',
			identifier: 'claude-4-sonnet',
			maxInputTokens: 200_000, // Snowflake Cortex AI model context limit
		},
		{
			name: 'Claude Sonnet 4.5',
			identifier: 'claude-sonnet-4-5',
			maxInputTokens: 200_000, // Snowflake Cortex AI model context limit
		},
		{
			name: 'GPT-4.1',
			identifier: 'openai-gpt-4.1',
			maxInputTokens: 128_000, // Typical GPT context window
		},
		{
			name: 'GPT-5',
			identifier: 'openai-gpt-5',
			maxInputTokens: 128_000, // Typical GPT context window
		},
	]]
]);

/**
 * Get all available model definitions for a provider, with intelligent fallback hierarchy:
 * 1. Custom models (from settings) - highest priority
 * 2. Built-in model definitions - fallback when no user config
 */
export function getAllModelDefinitions(providerId: string): ModelDefinition[] {
	const models = getCustomModels(providerId);
	if (models.length > 0) {
		return models;
	}
	return builtInModelDefinitions.get(providerId) || [];
}
