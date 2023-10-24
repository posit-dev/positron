/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

let _lspTraceOutputChannel: vscode.OutputChannel | undefined;
let rExtOutputChannel: vscode.LogOutputChannel;

export function initializeLogging(context: vscode.ExtensionContext) {

	const config = vscode.workspace.getConfiguration('positron.r');
	// I don't think the <boolean> here is working as intended.
	// Possible values are 'off', 'messages', 'verbose'.
	// As it stands, I think if (tracingEnabled) always evaluates to truthy now.
	const lspTracingEnabled = config.get<boolean>('trace.server');
	if (lspTracingEnabled) {
		_lspTraceOutputChannel = vscode.window.createOutputChannel('Positron R Language/Debug Server (Trace)');
	}

	rExtOutputChannel = vscode.window.createOutputChannel('Positron R Extension', { log: true });
}

export function getLogger() {
	return {
		trace: (message: string) => rExtOutputChannel.trace(message),
		info: (message: string) => rExtOutputChannel.info(message),
		warn: (message: string) => rExtOutputChannel.warn(message),
		error: (message: string) => rExtOutputChannel.error(message)
	};
}

export function lspTrace(message: string) {
	_lspTraceOutputChannel?.appendLine(message);
}

export function lspTraceOutputChannel() {
	return _lspTraceOutputChannel;
}
