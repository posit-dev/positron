/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookDocumentMetadata } from '../../notebook/common/notebookCommon.js';
import { hasKey } from '../../../../base/common/types.js';

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
 * Per-notebook assistant settings stored at metadata.positron.assistant
 *
 * Schema:
 *   metadata.positron.assistant: {
 *     showDiff?: 'showDiff' | 'noDiff'  // Per-notebook diff view override
 *     autoFollow?: 'autoFollow' | 'noAutoFollow'  // Per-notebook auto-follow override
 *   }
 */
export interface AssistantSettings {
	showDiff?: ShowDiffOverride;
	autoFollow?: AutoFollowOverride;
}

const VALID_SHOW_DIFF_VALUES = new Set<string>(['showDiff', 'noDiff']);
const VALID_AUTO_FOLLOW_VALUES = new Set<string>(['autoFollow', 'noAutoFollow']);

/**
 * Read assistant settings from notebook metadata.
 * Validates values and returns undefined for invalid entries.
 */
export function getAssistantSettings(metadata: NotebookDocumentMetadata | undefined): AssistantSettings {
	const positron = metadata?.positron as Record<string, unknown> | undefined;
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

	return { showDiff, autoFollow };
}

/**
 * Build new metadata with updated assistant settings.
 * Removes empty containers (assistant, positron) when all values are cleared.
 */
export function setAssistantSettings(
	metadata: NotebookDocumentMetadata,
	updates: Partial<AssistantSettings>
): NotebookDocumentMetadata {
	const currentPositron = (metadata.positron as Record<string, unknown>) ?? {};
	const currentAssistant = (currentPositron.assistant as Record<string, unknown>) ?? {};

	// Merge updates into assistant settings
	const newAssistant: Record<string, unknown> = { ...currentAssistant };

	if (hasKey(updates, 'showDiff')) {
		if (updates.showDiff === undefined) {
			delete newAssistant.showDiff;
		} else {
			newAssistant.showDiff = updates.showDiff;
		}
	}

	if (hasKey(updates, 'autoFollow')) {
		if (updates.autoFollow === undefined) {
			delete newAssistant.autoFollow;
		} else {
			newAssistant.autoFollow = updates.autoFollow;
		}
	}

	// Build new positron metadata, removing empty assistant container
	const newPositron: Record<string, unknown> = { ...currentPositron };
	if (Object.keys(newAssistant).length > 0) {
		newPositron.assistant = newAssistant;
	} else {
		delete newPositron.assistant;
	}

	// Build new root metadata, removing empty positron container
	const newMetadata: NotebookDocumentMetadata = { ...metadata };
	if (Object.keys(newPositron).length > 0) {
		newMetadata.positron = newPositron;
	} else {
		delete newMetadata.positron;
	}

	return newMetadata;
}
