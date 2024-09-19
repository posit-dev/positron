/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

import path = require('path');
import { DefaultApi } from './kcclient/api';
import { findAvailablePort } from './PortFinder';
import { KallichoreAdapterApi } from './kallichore-adapter';
import { KCApi } from './api';

export function activate(context: vscode.ExtensionContext): KallichoreAdapterApi {
	const log = vscode.window.createOutputChannel('Kallichore Adapter', { log: true });
	log.debug('Kallichore Adapter activated');
	return new KCApi(context, log);
}

async function startKallichore(context: vscode.ExtensionContext,
	log: vscode.LogOutputChannel
) {
	// TODO: re-use existing terminal instead of opening a new one every time;
	// can do this by attempting a network reconnect
	const kcExeName = os.platform() === 'win32' ? 'kcserver.exe' : 'kcserver';
	const shellPath = path.join(context.extensionPath, 'resources', 'kallichore', kcExeName);
	const env = {
		POSITRON: '1',
		POSITRON_VERSION: positron.version,
		RUST_LOG: 'debug'
	};


	// Find a port for the server to listen on
	const port = await findAvailablePort([], 10);

	log.info(`Starting Kallichore server ${shellPath} on port ${port}`);
	vscode.window.createTerminal(<vscode.TerminalOptions>{
		name: 'Kallichore',
		shellPath: shellPath,
		shellArgs: ['--port', port.toString()],
		env,
		message: '',
		hideFromUser: false,
		isTransient: false
	});
	// wait 1s for the server to start up
	setTimeout(() => {
		const api = new DefaultApi(`http://localhost:${port}`);
		api.listSessions().then(sessions => {
			log.info(`Kallichore server online with ${sessions.body.total} sessions`);
		});
	}, 1000);
}

export function deactivate() {
}
