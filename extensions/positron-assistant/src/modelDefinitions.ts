/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSettingNameForProvider } from './providerMetadata.js';

export interface ModelDefinition {
	name: string;
	identifier: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
}

/**
 * Get custom models from VS Code settings for a specific provider.
 *
 * Reads from the individual provider setting (models.overrides.<settingName>).
 * Legacy object-based settings are migrated on startup, so no fallback is needed.
 */
export function getCustomModels(providerId: string): ModelDefinition[] {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const settingName = getSettingNameForProvider(providerId);

	if (settingName) {
		const individualModels = config.get<ModelDefinition[]>(`models.overrides.${settingName}`);
		if (individualModels && individualModels.length > 0) {
			return individualModels;
		}
	}

	return [];
}

/**
 * Built-in model definitions that serve as fallback defaults when no user configuration
 * is provided and dynamic model querying is not available or fails.
 */
const builtInModelDefinitions = new Map<string, ModelDefinition[]>([
	['posit-ai', [
		{
			name: 'Claude Sonnet 4.5',
			identifier: 'claude-sonnet-4-5',
			maxInputTokens: 200_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			maxOutputTokens: 64_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		},
		{
			name: 'Claude Opus 4.1',
			identifier: 'claude-opus-4-1',
			maxInputTokens: 200_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			maxOutputTokens: 32_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		},
		{
			name: 'Claude Haiku 4.5',
			identifier: 'claude-haiku-4-5',
			maxInputTokens: 200_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
			maxOutputTokens: 64_000, // reference: https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		},
	]],
	['google', [
		{
			name: 'Gemini 2.5 Flash',
			identifier: 'gemini-2.5-pro-exp-03-25',
			maxOutputTokens: 65_536, // reference: https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-preview
		},
		{
			name: 'Gemini 2.0 Flash',
			identifier: 'gemini-2.0-flash-exp',
			maxOutputTokens: 8_192, // reference: https://ai.google.dev/gemini-api/docs/models#gemini-2.0-flash
		},
	]],
	// Model listing reference: https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql#regional-availability
	['snowflake-cortex', [
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
			name: 'Claude Haiku 4.5',
			identifier: 'claude-haiku-4-5',
			maxInputTokens: 200_000, // Snowflake Cortex AI model context limit
		},
		{
			name: 'GPT-5',
			identifier: 'openai-gpt-5',
			maxInputTokens: 128_000, // Typical GPT-5 context window
		},
		{
			name: 'GPT-4.1',
			identifier: 'openai-gpt-4.1',
			maxInputTokens: 128_000, // Typical GPT-5 context window
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
