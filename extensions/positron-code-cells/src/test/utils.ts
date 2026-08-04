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
 * Polls until the predicate succeeds or the timeout expires. On timeout, returns
 * without throwing so the caller's assertion can report the relevant failure.
 *
 * The generous default accommodates delayed editor events on loaded CI runners.
 * Successful waits still return as soon as the predicate passes.
 */
export async function waitFor(predicate: () => boolean, timeout = 15_000, interval = 50): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start >= timeout) {
			return;
		}
		await delay(interval);
	}
}
