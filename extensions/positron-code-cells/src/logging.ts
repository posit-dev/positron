/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;
export function initializeLogging() {
	channel = vscode.window.createOutputChannel('Positron Code Cells');
}

export function trace(message: string) {
	channel?.appendLine(message);
}
