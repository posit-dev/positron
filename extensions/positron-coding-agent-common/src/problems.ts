/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/** A button on a problem's notification. */
export interface ProblemAction {
	readonly title: string;
	run(): Thenable<unknown>;
}

/**
 * Explain a problem the user can fix, e.g. a missing command or a setting,
 * with buttons that lead to the fix.
 * @param window `vscode.window`.
 */
export async function showProblem(window: Pick<typeof vscode.window, 'showWarningMessage'>, message: string, actions: readonly ProblemAction[]): Promise<void> {
	const choice = await window.showWarningMessage(message, ...actions.map(action => action.title));
	await actions.find(action => action.title === choice)?.run();
}
