/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from './extension.js';
import { DEFAULT_SELECTABLE_PATTERNS } from './constants.js';
import { markDefaultModel } from './modelResolutionHelpers.js';

/**
 * Check if a model matches a user-defined filter pattern.
 */
export function matchesModelFilter(pattern: string, id: string, name: string): boolean {
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
 * Apply model filters to a list of models
 * Filters are applied in two stages:
 * 1. models.include (strict): Removes non-matching models entirely based on user config
 * 2. Marks non-matching models as not user-selectable based on system defaults
 *
 */
export function applyModelFilters(
	models: vscode.LanguageModelChatInformation[],
	vendor: string,
	providerName: string,
	defaultMatch?: string
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

	// Stage 1: Apply strict filtering (models.include)
	const includePatterns = vscode.workspace.getConfiguration('positron.assistant').get<string[]>('models.include', []);
	log.debug(`[${providerName}] Patterns from models.include config: ${includePatterns.join(', ')}`);

	let filteredModels = models;
	if (includePatterns.length > 0) {
		filteredModels = models.filter(model =>
			includePatterns.some(pattern =>
				matchesModelFilter(pattern, model.id, model.name)
			)
		);

		const removedCount = models.length - filteredModels.length;
		if (removedCount > 0) {
			log.debug(`[${providerName}] Removed ${removedCount} models not in models.include`);
		}
		if (filteredModels.length === 0) {
			log.warn(`[${providerName}] No models match models.include patterns.`);
			return filteredModels;
		}
	}

	// Stage 2: Apply soft filtering (Positron user selectable defaults)
	filteredModels = filteredModels.map(model => {
		const matches = DEFAULT_SELECTABLE_PATTERNS.some(pattern =>
			matchesModelFilter(pattern, model.id, model.name)
		);

		if (!matches) {
			// Clone the model info and set isUserSelectable to false
			return {
				...model,
				isUserSelectable: false
			};
		}

		return model;
	});

	const userSelectableCount = filteredModels.filter(m => m.isUserSelectable !== false).length;
	const nonSelectableCount = filteredModels.length - userSelectableCount;

	if (userSelectableCount === 0) {
		log.warn(`[${providerName}] No user-selectable models remain after applying system defaults.`);
	} else if (userSelectableCount === 1) {
		log.debug(`[${providerName}] 1 user-selectable model after applying system defaults (${nonSelectableCount} non-selectable): ${filteredModels.find(m => m.isUserSelectable !== false)?.id}`);
	} else {
		log.debug(`[${providerName}] ${userSelectableCount} user-selectable models after applying system defaults (${nonSelectableCount} non-selectable): ${filteredModels.filter(m => m.isUserSelectable !== false).map(m => m.id).join(', ')}`);
	}

	// TODO: Consider refactoring so that selecting the default model only happens after filtering
	// Check if the default model was filtered out
	const hasDefault = filteredModels.some(m => m.isDefault);
	if (!hasDefault && filteredModels.length > 0) {
		// Find the original default model that was filtered out for logging
		const originalDefault = models.find(m => m.isDefault);
		if (originalDefault) {
			log.info(`[${providerName}] Configured default model '${originalDefault.id}' was filtered out; re-selecting default from remaining models.`);
		}
		// Re-select default from the filtered list
		filteredModels = markDefaultModel(filteredModels, vendor, defaultMatch);
	}

	return filteredModels;
}
