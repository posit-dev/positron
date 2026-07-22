/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export function disposeAll(disposables: vscode.Disposable[]) {
	vscode.Disposable.from(...disposables).dispose();
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll `predicate` until it returns true or the timeout elapses.
 *
 * Useful for asserting on state that updates asynchronously (e.g. editor
 * decorations that refresh after an editor event fires). Returns once the
 * predicate passes; on timeout it returns anyway so the caller's own assertion
 * can produce a meaningful failure message.
 */
export async function waitFor(predicate: () => boolean, timeout = 2000, interval = 50): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start >= timeout) {
			return;
		}
		await delay(interval);
	}
}
