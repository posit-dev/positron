/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ModelDefinition {
	name: string;
	identifier: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
}

/**
 * Get user-configured models from VS Code settings for a specific provider.
 */
export function getConfiguredModels(providerId: string): ModelDefinition[] {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const configuredModels = config.get<Record<string, ModelDefinition[]>>('configuredModels', {});
	return configuredModels[providerId] || [];
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
	]]
]);

/**
 * Get all available model definitions for a provider, with intelligent fallback hierarchy:
 * 1. User-configured models (from settings) - highest priority
 * 2. Built-in model definitions - fallback when no user config
 */
export function getAllModelDefinitions(providerId: string): ModelDefinition[] {
	const configured = getConfiguredModels(providerId);
	if (configured.length > 0) {
		return configured;
	}
	return builtInModelDefinitions.get(providerId) || [];
}

