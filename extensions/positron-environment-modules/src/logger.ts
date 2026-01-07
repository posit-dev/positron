/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// Output channel for logging
let log: vscode.LogOutputChannel | undefined;

export function getLog(): vscode.LogOutputChannel {
	if (!log) {
		log = vscode.window.createOutputChannel('Environment Modules', { log: true });
	}
	return log;
}
