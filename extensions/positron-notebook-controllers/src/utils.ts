/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension';

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatCount(count: number, unit: string): string {
	if (count === 1) {
		return `${count} ${unit}`;
	}
	return `${count} ${unit}s`;
}

/**
 * Check if a given notebook URI is the current active notebook editor.
 *
 * @param notebookUri The notebook URI to check.
 * @returns True if the notebook URI is the current active notebook editor.
 */
export function isActiveNotebookEditorUri(notebookUri: vscode.Uri): boolean {
	const activeNotebookEditorUri = vscode.window.activeNotebookEditor?.notebook.uri;
	return Boolean(activeNotebookEditorUri &&
		notebookUri.toString() === activeNotebookEditorUri.toString());
}

/**
 * Get the language runtime session for a notebook.
 *
 * @param notebookUri The URI of the notebook.
 * @param runtimeId Optional runtime ID to filter the session by.
 * @returns Promise that resolves with the language runtime session, or `undefined` if no session is found.
 */
export async function getNotebookSession(
	notebookUri: vscode.Uri, runtimeId?: string,
): Promise<positron.LanguageRuntimeSession | undefined> {
	// Get the session for the notebook.
	const session = await positron.runtime.getNotebookSession(notebookUri);
	if (!session) {
		return undefined;
	}

	// Ensure that the session is for the requested runtime.
	if (runtimeId && session.runtimeMetadata.runtimeId !== runtimeId) {
		log.warn(`Expected session for notebook ${notebookUri} to be for runtime ${runtimeId}, ` +
			`but it is for runtime ${session.runtimeMetadata.runtimeId}`);
		return undefined;
	}

	return session;
}
