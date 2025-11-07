/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from './extension.js';

/**
 * Smart pattern matching for model filters. Supports both explicit glob patterns
 * and simple model name matching across multiple fields.
 * Based on src/vs/workbench/contrib/positronAssistant/common/utils/modelFilters.ts,
 * but simplified to not require identifier. Also includes a simple glob matching function.
 */
function matchesModelFilter(pattern: string, id: string, name: string): boolean {
	const normalizedPattern = pattern.toLowerCase().trim();
	const values = [id, name].map(v => v.toLowerCase());

	// If pattern contains wildcards, use simplified glob matching
	if (normalizedPattern.includes('*')) {
		return values.some(value => simpleGlobMatch(normalizedPattern, value));
	}

	// Smart matching for simple model names
	return values.some(value => {
		// Direct substring match (handles "gpt" matching "gpt-4o")
		if (value.includes(normalizedPattern)) { return true; }

		// Path-aware matching (handles "gpt" matching "openai/gpt-5")
		const pathParts = value.split(/[\/\-]/);
		if (pathParts.some(part => part.includes(normalizedPattern))) { return true; }

		// Word boundary matching (handles "claude" matching "Claude Opus 4")
		const words = value.split(/[\s\-\/]/);
		if (words.some(word => word.includes(normalizedPattern))) { return true; }

		return false;
	});
}

/**
 * Simple glob pattern matching for * wildcards
 */
function simpleGlobMatch(pattern: string, text: string): boolean {
	// Convert glob pattern to regex
	const regexPattern = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
		.replace(/\*/g, '.*'); // Replace * with .*
	const regex = new RegExp(`^${regexPattern}$`, 'i');
	return regex.test(text);
}

/**
 * Applies model filters to a list of models
 * @param config The model configuration
 * @param models The list of models to filter
 * @param vendor The vendor/provider name
 * @returns The filtered list of models
 */
export function applyModelFilters(
	models: vscode.LanguageModelChatInformation[],
	vendor: string,
	providerName: string
): vscode.LanguageModelChatInformation[] {
	log.info(`[${providerName}] Total models before applying user settings: ${models.length}`);
	log.debug(`[${providerName}] Models before applying user settings: ${models.map(m => m.id).join(', ')}`);

	// Check if this vendor is in the unfiltered providers list
	let unfilteredProviders = vscode.workspace.getConfiguration('positron.assistant').get<string[]>('unfilteredProviders', []);
	log.debug(`[${providerName}] (${vendor}) Unfiltered providers from config: ${unfilteredProviders.join(', ')}`);

	if (unfilteredProviders.length === 0) {
		// If no configuration, default to known test providers
		unfilteredProviders = ['test-lm-vendor', 'echo'];
	}
	if (unfilteredProviders.includes(vendor)) {
		log.debug(`[${providerName}] Skipping model filtering for unfiltered provider: ${vendor}`);
		return models;
	}

	// Get the filter patterns from workspace configuration
	const filterModels = vscode.workspace.getConfiguration('positron.assistant').get<string[]>('filterModels', []);
	log.debug(`[${providerName}] Model filter patterns from config: ${filterModels.join(', ')}`);
	if (filterModels.length === 0) {
		return models;
	}

	// Filter models based on patterns
	const filteredModels = models.filter(model =>
		filterModels.some(pattern =>
			matchesModelFilter(pattern, model.id, model.name)
		)
	);

	log.info(`[${providerName}] Total models after applying user settings: ${filteredModels.length}`);
	log.debug(`[${providerName}] Models after applying user settings: ${filteredModels.map(m => m.id).join(', ')}`);

	return filteredModels;
}
