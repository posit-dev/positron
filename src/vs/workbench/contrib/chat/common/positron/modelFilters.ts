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

	// Stage 1: Apply strict filtering (models.required)
	const requiredPatterns = configurationService.getValue<string[]>('positron.assistant.models.required') || [];
	logService.trace(`[LM] ${vendor} Patterns from models.required config: ${requiredPatterns.join(', ')}`);

	let filteredModels = models;
	if (requiredPatterns.length > 0) {
		filteredModels = models.filter(model =>
			requiredPatterns.some(pattern =>
				matchesModelFilter(pattern, model.metadata.id, model.metadata.name)
			)
		);

		const removedCount = models.length - filteredModels.length;
		if (removedCount > 0) {
			logService.trace(`[LM] ${vendor} Removed ${removedCount} models not in models.required`);
		}
		if (filteredModels.length === 0) {
			logService.warn(`[LM] ${vendor} No models match models.required patterns.`);
			return filteredModels;
		}
	}

	// Stage 2: Apply soft filtering (models.visible)
	const visiblePatterns = configurationService.getValue<string[]>('positron.assistant.models.visible') || [];
	logService.trace(`[LM] ${vendor} Patterns from models.visible config: ${visiblePatterns.join(', ')}`);

	if (visiblePatterns.length === 0) {
		if (requiredPatterns.length === 0) {
			logService.trace(`[LM] ${vendor} No filters configured, returning all ${filteredModels.length} models`);
		}
		return filteredModels;
	}

	filteredModels = filteredModels.map(model => {
		const matches = visiblePatterns.some(pattern =>
			matchesModelFilter(pattern, model.metadata.id, model.metadata.name)
		);

		if (!matches) {
			// Clone the model info and set isUserSelectable to false
			return {
				...model,
				metadata: {
					...model.metadata,
					isUserSelectable: false
				}
			};
		}

		return model;
	});

	const userSelectableCount = filteredModels.filter(m => m.metadata.isUserSelectable !== false).length;
	const nonSelectableCount = filteredModels.length - userSelectableCount;

	if (userSelectableCount === 0) {
		logService.warn(`[LM] ${vendor} No user-selectable models remain after applying user settings.`);
	} else if (userSelectableCount === 1) {
		logService.trace(`[LM] ${vendor} 1 user-selectable model after applying user settings (${nonSelectableCount} non-selectable): ${filteredModels.find(m => m.metadata.isUserSelectable !== false)?.metadata.id}`);
	} else {
		logService.trace(`[LM] ${vendor} ${userSelectableCount} user-selectable models after applying user settings (${nonSelectableCount} non-selectable): ${filteredModels.filter(m => m.metadata.isUserSelectable !== false).map(m => m.metadata.id).join(', ')}`);
	}

	return filteredModels;
}
