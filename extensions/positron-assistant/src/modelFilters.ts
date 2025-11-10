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
	if (models.length === 0) {
		log.debug(`[${providerName}] No models to filter.`);
		return models;
	}

	log.debug(`[${providerName}] ${models.length} Models before applying user settings: ${models.map(m => m.id).join(', ')}`);

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

	log.debug(`[${providerName}] ${filteredModels.length} Models after applying user settings: ${filteredModels.map(m => m.id).join(', ')}`);

	return filteredModels;
}
