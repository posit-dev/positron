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

export async function getRunningNotebookSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession | undefined> {
	// TODO: Use getSessions()?
	// TODO: Check that it's the expected runtime?
	return positron.runtime.getNotebookSession(notebookUri);
	// const state = session?.state;
	// if (state === positron.RuntimeState.Uninitialized
	// 	|| state === positron.RuntimeState.Exiting
	// 	|| state === positron.RuntimeState.Exited) {
	// 	return undefined;
	// }
	// return session;
}
