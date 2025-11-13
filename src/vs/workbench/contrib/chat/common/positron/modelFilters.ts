/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../languageModels.js';

/**
 * Copied from extensions/positron-assistant/src/modelFilters.ts.
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
 * Copied from extensions/positron-assistant/src/modelFilters.ts.
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
 * Copied from extensions/positron-assistant/src/modelFilters.ts and adapted
 * to work in the core context.
 * Please keep in sync!
 */
export function applyModelFilters(
	models: ILanguageModelChatMetadataAndIdentifier[],
	vendor: string,
	configurationService: IConfigurationService,
	logService: ILogService
): ILanguageModelChatMetadataAndIdentifier[] {
	if (models.length === 0) {
		return models;
	}
	logService.trace(`[LM] ${vendor} ${models.length} Models before applying user settings: ${models.map(m => m.metadata.id).join(', ')}`);

	// Check if this vendor is in the unfiltered providers list
	let unfilteredProviders = configurationService.getValue<string[]>('positron.assistant.unfilteredProviders') || [];
	logService.trace(`[LM] ${vendor} Unfiltered providers from config: ${unfilteredProviders.join(', ')}`);

	if (unfilteredProviders.length === 0) {
		// If no configuration, default to known test providers
		unfilteredProviders = ['test-lm-vendor', 'echo'];
	}
	if (unfilteredProviders.includes(vendor)) {
		logService.trace(`[LM] ${vendor} Skipping model filtering for unfiltered provider: ${vendor}`);
		return models;
	}

	// Get the filter patterns from workspace configuration
	const filterModels = configurationService.getValue<string[]>('positron.assistant.filterModels') || [];
	logService.trace(`[LM] ${vendor} Patterns from filterModels config: ${filterModels.join(', ')}`);
	if (filterModels.length === 0) {
		return models;
	}

	// Filter models based on patterns
	const filteredModels = models.filter(model =>
		filterModels.some(pattern =>
			matchesModelFilter(pattern, model.metadata.id, model.metadata.name)
		)
	);

	logService.trace(`[LM] ${vendor} ${filteredModels.length} Models after applying user settings: ${filteredModels.map(m => m.metadata.id).join(', ')}`);
	return filteredModels;
}
