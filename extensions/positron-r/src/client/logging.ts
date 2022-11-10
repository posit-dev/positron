/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

let _traceOutputChannel: vscode.OutputChannel | undefined;

export function initializeLogging(context: vscode.ExtensionContext) {

	const config = vscode.workspace.getConfiguration('positron.r');
	const tracingEnabled = config.get<boolean>('trace.server');
	if (tracingEnabled) {
		_traceOutputChannel = vscode.window.createOutputChannel('Positron R Language Server (Trace)');
	}

}

export function trace(message: string) {
	_traceOutputChannel?.appendLine(message);
}

export function traceOutputChannel() {
	return _traceOutputChannel;
}
