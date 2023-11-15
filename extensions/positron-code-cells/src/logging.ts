/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;
export function initializeLogging() {
	channel = vscode.window.createOutputChannel('Positron Code Cells');
}

export function trace(message: string) {
	channel?.appendLine(message);
}
