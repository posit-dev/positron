/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Shape of Positron assistant metadata stored in notebooks.
 * Add new settings here as the pattern expands.
 */
export interface PositronAssistantMetadata {
	showDiff?: 'showDiff' | 'noDiff';
	// Future settings can be added here:
	// autoExecute?: 'always' | 'never';
	// maxCellsToEdit?: number;
}

/**
 * Read Positron assistant metadata from a notebook.
 */
export function getAssistantMetadata(notebook: vscode.NotebookDocument): PositronAssistantMetadata {
	const positron = notebook.metadata?.positron as Record<string, unknown> | undefined;
	return (positron?.assistant as PositronAssistantMetadata) ?? {};
}

/**
 * Update Positron assistant metadata in a notebook.
 * Merges with existing metadata, preserving other fields.
 */
export async function updateAssistantMetadata(
	notebook: vscode.NotebookDocument,
	updates: Partial<PositronAssistantMetadata>
): Promise<boolean> {
	const currentMetadata = { ...notebook.metadata };
	const currentPositron = (currentMetadata.positron as Record<string, unknown>) ?? {};
	const currentAssistant = (currentPositron.assistant as PositronAssistantMetadata) ?? {};

	// Merge updates, removing undefined values
	const newAssistant = { ...currentAssistant };
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) {
			delete newAssistant[key as keyof PositronAssistantMetadata];
		} else {
			(newAssistant as Record<string, unknown>)[key] = value;
		}
	}

	// Build new metadata tree
	const newPositron: Record<string, unknown> = {
		...currentPositron,
		assistant: Object.keys(newAssistant).length > 0 ? newAssistant : undefined
	};

	// Clean up empty objects
	if (!newPositron.assistant) {
		delete newPositron.assistant;
	}

	const newMetadata: Record<string, unknown> = {
		...currentMetadata,
		positron: Object.keys(newPositron).length > 0 ? newPositron : undefined
	};

	if (!newMetadata.positron) {
		delete newMetadata.positron;
	}

	const edit = new vscode.WorkspaceEdit();
	edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(newMetadata)]);
	return vscode.workspace.applyEdit(edit);
}

/**
 * Resolve a setting value: notebook metadata first, then global config fallback.
 */
export function resolveAssistantSetting<K extends keyof PositronAssistantMetadata>(
	notebook: vscode.NotebookDocument,
	key: K,
	globalConfigKey: string,
	defaultValue: boolean
): boolean {
	const metadata = getAssistantMetadata(notebook);
	const override = metadata[key];

	if (override !== undefined) {
		// Map string enum to boolean for showDiff pattern
		if (key === 'showDiff') {
			return override === 'showDiff';
		}
		return Boolean(override);
	}

	return vscode.workspace.getConfiguration().get(globalConfigKey, defaultValue);
}
