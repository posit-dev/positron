/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
 * Per-notebook assistant settings stored at metadata.metadata.positron.assistant
 *
 * The ipynb serializer maps:
 *   VS Code model metadata.metadata -> ipynb file metadata
 */
export interface AssistantSettings {
	showDiff?: ShowDiffOverride;
	autoFollow?: AutoFollowOverride;
	ghostCellSuggestions?: GhostCellSuggestionsOverride;
}

const VALID_SHOW_DIFF_VALUES = new Set<string>(['showDiff', 'noDiff']);
const VALID_AUTO_FOLLOW_VALUES = new Set<string>(['autoFollow', 'noAutoFollow']);
const VALID_GHOST_CELL_SUGGESTIONS_VALUES = new Set<string>(['enabled', 'disabled']);

/**
 * Read assistant settings from notebook metadata.
 * Validates values and returns undefined for invalid entries.
 */
export function getAssistantSettings(metadata: { [key: string]: unknown } | undefined): AssistantSettings {
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

	return { showDiff, autoFollow, ghostCellSuggestions };
}

/**
 * Resolve showDiff setting: notebook metadata first, then global config fallback.
 */
export function resolveShowDiff(notebook: vscode.NotebookDocument): boolean {
	const settings = getAssistantSettings(notebook.metadata);

	if (settings.showDiff !== undefined) {
		return settings.showDiff === 'showDiff';
	}

	return vscode.workspace.getConfiguration('positron.assistant.notebook').get('showDiff', true);
}

/**
 * Resolve autoFollow setting: notebook metadata first, then global config fallback.
 */
export function resolveAutoFollow(notebook: vscode.NotebookDocument): boolean {
	const settings = getAssistantSettings(notebook.metadata);

	if (settings.autoFollow !== undefined) {
		return settings.autoFollow === 'autoFollow';
	}

	return vscode.workspace.getConfiguration('positron.assistant.notebook').get('autoFollow', true);
}

/**
 * Resolve ghostCellSuggestions setting: notebook metadata first, then check opt-in, then global config.
 */
export function resolveGhostCellSuggestions(notebook: vscode.NotebookDocument): boolean {
	const settings = getAssistantSettings(notebook.metadata);

	if (settings.ghostCellSuggestions !== undefined) {
		return settings.ghostCellSuggestions === 'enabled';
	}

	// Check if user has opted in - if not, return false (workbench handles showing prompt)
	const config = vscode.workspace.getConfiguration('positron.assistant.notebook.ghostCellSuggestions');
	const hasOptedIn = config.get('hasOptedIn', false);
	if (!hasOptedIn) {
		return false;
	}

	return vscode.workspace.getConfiguration('positron.assistant.notebook').get('ghostCellSuggestions', false);
}
