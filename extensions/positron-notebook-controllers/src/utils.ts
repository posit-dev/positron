/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

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
		return undefined;
	}

	return session;
}
