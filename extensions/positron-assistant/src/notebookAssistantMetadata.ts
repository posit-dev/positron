/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Valid values for the showDiff per-notebook override.
 * undefined = follow global setting, 'showDiff' = always show, 'noDiff' = never show
 */
export type ShowDiffOverride = 'showDiff' | 'noDiff' | undefined;

/**
 * Per-notebook assistant settings stored at metadata.positron.assistant
 */
export interface AssistantSettings {
	showDiff?: ShowDiffOverride;
}

const VALID_SHOW_DIFF_VALUES = new Set<string>(['showDiff', 'noDiff']);

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

	return { showDiff };
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
