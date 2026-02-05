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
 * Per-notebook assistant settings stored at metadata.positron.assistant
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
export function getAssistantSettings(metadata: { [key: string]: unknown } | undefined): AssistantSettings {
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
