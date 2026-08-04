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
 *
 * The default timeout is deliberately generous: polling exits as soon as the
 * predicate passes, so it only delays genuinely failing runs. A loaded CI
 * runner has been observed to delay editor event delivery beyond 2 seconds
 * (see https://github.com/posit-dev/positron/pull/15289 checks), while the
 * mocha per-test cap for this suite is 60 seconds.
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
