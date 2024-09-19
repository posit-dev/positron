/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

import path = require('path');

export function activate(context: vscode.ExtensionContext) {
	// TODO: re-use existing terminal instead of opening a new one every time;
	// can do this by attempting a network reconnect
	const kcExeName = os.platform() === 'win32' ? 'kcserver.exe' : 'kcserver';
	const shellPath = path.join(context.extensionPath, 'resources', 'kallichore', kcExeName);
	const env = {
		POSITRON: '1',
		POSITRON_VERSION: positron.version,
		RUST_LOG: 'debug'
	};
	vscode.window.createTerminal(<vscode.TerminalOptions>{
		name: 'Kallichore',
		shellPath: shellPath,
		shellArgs: [],
		env,
		message: '',
		hideFromUser: false,
		isTransient: false
	});
}

export function deactivate() {
}
