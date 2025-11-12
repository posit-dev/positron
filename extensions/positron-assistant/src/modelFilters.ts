/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from './extension.js';

/**
 * Check if a model matches a user-defined filter pattern.
 * Copied to src/vs/workbench/contrib/chat/common/positron/modelFilters.ts.
 * Please keep in sync!
 */
function matchesModelFilter(pattern: string, id: string, name: string): boolean {
	const normalizedPattern = pattern.toLowerCase().trim();
	const values = [id, name].map(v => v.toLowerCase());

	// If pattern contains wildcards or regex chars, use regex matching
	if (normalizedPattern.includes('*') || /[.+^${}()|[\]\\]/.test(normalizedPattern)) {
		return values.some(value => regexMatch(normalizedPattern, value));
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
 * Regex pattern matching with smart defaults for simple cases
 * Copied to src/vs/workbench/contrib/chat/common/positron/modelFilters.ts.
 * Please keep in sync!
 */
function regexMatch(pattern: string, text: string): boolean {
	try {
		// Check if it looks like regex (contains regex special chars)
		if (/[.+^${}()|[\]\\]/.test(pattern)) {
			// Advanced regex pattern - use as-is
			const regex = new RegExp(pattern, 'i');
			return regex.test(text);
		}

		// Handle simple wildcard patterns (only plain * wildcards)
		if (pattern.includes('*')) {
			// Convert wildcards to regex
			const regexPattern = pattern
				.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
				.replace(/\*\*/g, '.*') // Replace ** with .*
				.replace(/\*/g, '.*'); // Replace remaining * with .*

			// For wildcard patterns, use anchored matching (like original glob behavior)
			const regex = new RegExp(`^${regexPattern}$`, 'i');
			return regex.test(text);
		}

		// Simple text pattern - treat as substring match
		return text.toLowerCase().includes(pattern.toLowerCase());
	} catch {
		return false; // Invalid regex
	}
}

/**
 * Apply user-defined model filters to a list of models
 * Copied to src/vs/workbench/contrib/chat/common/positron/modelFilters.ts with adaptations.
 * Please keep in sync!
 */
export function applyModelFilters(
	models: vscode.LanguageModelChatInformation[],
	vendor: string,
	providerName: string
): vscode.LanguageModelChatInformation[] {
	if (models.length === 0) {
		log.debug(`[${providerName}] No models to filter.`);
		return models;
	} else if (models.length === 1) {
		log.debug(`[${providerName}] 1 model before applying user settings: ${models[0].id}`);
	} else {
		log.debug(`[${providerName}] ${models.length} models before applying user settings: ${models.map(m => m.id).join(', ')}`);
	}

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
	log.debug(`[${providerName}] Patterns from filterModels config: ${filterModels.join(', ')}`);
	if (filterModels.length === 0) {
		return models;
	}

	// Filter models based on patterns
	const filteredModels = models.filter(model =>
		filterModels.some(pattern =>
			matchesModelFilter(pattern, model.id, model.name)
		)
	);

	if (filteredModels.length === 0) {
		log.warn(`[${providerName}] No models remain after applying user settings.`);
	} else if (filteredModels.length === 1) {
		log.debug(`[${providerName}] 1 model after applying user settings: ${filteredModels[0].id}`);
	} else {
		log.debug(`[${providerName}] ${filteredModels.length} models after applying user settings: ${filteredModels.map(m => m.id).join(', ')}`);
	}

	return filteredModels;
}
