/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * IMPORTANT: This module is intentionally duplicated across the extension/workbench boundary.
 * The extension counterpart lives at:
 *   extensions/positron-assistant/src/notebookAssistantMetadata.ts
 *
 * The two files share identical types (AssistantSettings, override types) and validation
 * logic (getAssistantSettings). The only difference is the parameter type of
 * getAssistantSettings: the extension version accepts `{ [key: string]: unknown } | undefined`
 * while this file accepts `NotebookDocumentMetadata | undefined`.
 *
 * When modifying types or validation logic, update BOTH files.
 */

import { NotebookDocumentMetadata } from '../../notebook/common/notebookCommon.js';

/**
 * Valid values for the showDiff per-notebook override.
 * undefined = follow global setting, 'showDiff' = always show, 'noDiff' = never show
 */
export type ShowDiffOverride = 'showDiff' | 'noDiff' | undefined;

/**
 * Valid values for the autoFollow per-notebook override.
 * undefined = follow global setting, 'autoFollow' = always auto-follow, 'noAutoFollow' = never auto-follow
 */
export type AutoFollowOverride = 'autoFollow' | 'noAutoFollow' | undefined;

/**
 * Valid values for the ghostCellSuggestions per-notebook override.
 * undefined = follow global setting, 'enabled' = always show, 'disabled' = never show
 */
export type GhostCellSuggestionsOverride = 'enabled' | 'disabled' | undefined;

/**
 * Valid values for the automatic per-notebook override.
 * undefined = follow global setting, true = automatic, false = on-demand
 */
export type AutomaticOverride = boolean | undefined;

/**
 * Per-notebook assistant settings stored at metadata.metadata.positron.assistant
 *
 * The ipynb serializer maps:
 *   VS Code model metadata.metadata -> ipynb file metadata
 *
 * Schema (in ipynb file):
 *   metadata.positron.assistant: {
 *     showDiff?: 'showDiff' | 'noDiff'  // Per-notebook diff view override
 *     autoFollow?: 'autoFollow' | 'noAutoFollow'  // Per-notebook auto-follow override
 *     ghostCellSuggestions?: 'enabled' | 'disabled'  // Per-notebook ghost cell suggestions override
 *     automatic?: boolean  // Per-notebook automatic mode override
 *   }
 */
export interface AssistantSettings {
	showDiff?: ShowDiffOverride;
	autoFollow?: AutoFollowOverride;
	ghostCellSuggestions?: GhostCellSuggestionsOverride;
	automatic?: AutomaticOverride;
}

const VALID_SHOW_DIFF_VALUES = new Set<string>(['showDiff', 'noDiff']);
const VALID_AUTO_FOLLOW_VALUES = new Set<string>(['autoFollow', 'noAutoFollow']);
const VALID_GHOST_CELL_SUGGESTIONS_VALUES = new Set<string>(['enabled', 'disabled']);

/**
 * Read assistant settings from notebook metadata.
 * Validates values and returns undefined for invalid entries.
 */
export function getAssistantSettings(metadata: NotebookDocumentMetadata | undefined): AssistantSettings {
	// Access inner metadata (this is what gets serialized to ipynb file)
	const innerMetadata = metadata?.metadata as Record<string, unknown> | undefined;
	const positron = innerMetadata?.positron as Record<string, unknown> | undefined;
	const assistant = positron?.assistant as Record<string, unknown> | undefined;

	// Validate showDiff value
	const rawShowDiff = assistant?.showDiff;
	const showDiff = typeof rawShowDiff === 'string' && VALID_SHOW_DIFF_VALUES.has(rawShowDiff)
		? rawShowDiff as ShowDiffOverride
		: undefined;

	// Validate autoFollow value
	const rawAutoFollow = assistant?.autoFollow;
	const autoFollow = typeof rawAutoFollow === 'string' && VALID_AUTO_FOLLOW_VALUES.has(rawAutoFollow)
		? rawAutoFollow as AutoFollowOverride
		: undefined;

	// Validate ghostCellSuggestions value
	const rawGhostCellSuggestions = assistant?.ghostCellSuggestions;
	const ghostCellSuggestions = typeof rawGhostCellSuggestions === 'string' && VALID_GHOST_CELL_SUGGESTIONS_VALUES.has(rawGhostCellSuggestions)
		? rawGhostCellSuggestions as GhostCellSuggestionsOverride
		: undefined;

	// Validate automatic value (boolean)
	const rawAutomatic = assistant?.automatic;
	const automatic = typeof rawAutomatic === 'boolean'
		? rawAutomatic as AutomaticOverride
		: undefined;

	return { showDiff, autoFollow, ghostCellSuggestions, automatic };
}

/**
 * Build new metadata with updated assistant settings.
 * Removes empty containers (assistant, positron) when all values are cleared.
 */
export function setAssistantSettings(
	metadata: NotebookDocumentMetadata,
	updates: Partial<AssistantSettings>
): NotebookDocumentMetadata {
	// Access inner metadata (this is what gets serialized to ipynb file)
	const innerMetadata = (metadata.metadata as Record<string, unknown>) ?? {};
	const currentPositron = (innerMetadata.positron as Record<string, unknown>) ?? {};
	const currentAssistant = (currentPositron.assistant as Record<string, unknown>) ?? {};

	// Merge updates into assistant settings
	// Apply updates dynamically - undefined values remove the key, defined values set it
	const newAssistant: Record<string, unknown> = { ...currentAssistant };
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) {
			delete newAssistant[key];
		} else {
			newAssistant[key] = value;
		}
	}

	// Build new positron metadata, removing empty assistant container
	const newPositron: Record<string, unknown> = { ...currentPositron };
	if (Object.keys(newAssistant).length > 0) {
		newPositron.assistant = newAssistant;
	} else {
		delete newPositron.assistant;
	}

	// Build new inner metadata, removing empty positron container
	const newInnerMetadata: Record<string, unknown> = { ...innerMetadata };
	if (Object.keys(newPositron).length > 0) {
		newInnerMetadata.positron = newPositron;
	} else {
		delete newInnerMetadata.positron;
	}

	// Build new root metadata with updated inner metadata
	const newMetadata: NotebookDocumentMetadata = { ...metadata };
	newMetadata.metadata = newInnerMetadata;

	return newMetadata;
}
